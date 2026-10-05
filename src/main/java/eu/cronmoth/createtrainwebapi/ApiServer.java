package eu.cronmoth.createtrainwebapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.cronmoth.createtrainwebapi.model.ContraptionModelData;
import io.undertow.Undertow;
import io.undertow.server.HttpHandler;
import io.undertow.server.handlers.PathHandler;
import io.undertow.server.handlers.resource.FileResourceManager;
import io.undertow.server.handlers.resource.ResourceHandler;
import io.undertow.server.handlers.sse.ServerSentEventHandler;
import io.undertow.util.Headers;
import io.undertow.util.HttpString;
import io.undertow.util.StatusCodes;

import java.io.File;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class ApiServer {
    private Undertow server;
    private ScheduledExecutorService scheduler;
    private final ObjectMapper mapper = new ObjectMapper();

    public void start(String host, int port, String trainModelPath) {
        PathHandler pathHandler = new PathHandler();

        pathHandler.addExactPath("/trains", exchange -> {
            addJsonHeaders(exchange);
            exchange.getResponseSender().send(mapper.writeValueAsString(TrackInformation.GetTrainData()));
        });

        pathHandler.addExactPath("/network", exchange -> {
            addJsonHeaders(exchange);
            exchange.getResponseSender().send(mapper.writeValueAsString(TrackInformation.GetNetworkData()));
        });

        pathHandler.addExactPath("/contraptions", exchange -> {
            addJsonHeaders(exchange);
            exchange.getResponseSender().send(mapper.writeValueAsString(ContraptionInformation.getContraptions()));
        });

        pathHandler.addPrefixPath("/contraptionModels", exchange -> {
            addJsonHeaders(exchange);

            String modelId = exchange.getRelativePath();
            if (modelId.startsWith("/")) {
                modelId = modelId.substring(1);
            }
            if (modelId.endsWith(".json")) {
                modelId = modelId.substring(0, modelId.length() - 5);
            }

            if (modelId.isBlank()) {
                exchange.setStatusCode(StatusCodes.BAD_REQUEST);
                exchange.getResponseSender().send("{\"error\":\"model id is required\"}");
                return;
            }

            ContraptionModelData model = ContraptionInformation.getModel(modelId);
            if (model == null) {
                exchange.setStatusCode(StatusCodes.NOT_FOUND);
                exchange.getResponseSender().send("{\"error\":\"contraption model not found\"}");
                return;
            }

            exchange.getResponseSender().send(mapper.writeValueAsString(model));
        });

        scheduler = Executors.newScheduledThreadPool(6);

        pathHandler.addExactPath("/trainsLive", exchange -> {
            addSseHeaders(exchange);
            new ServerSentEventHandler((connection, lastEventId) -> {
                ScheduledFuture<?> future = scheduler.scheduleAtFixedRate(() -> {
                    if (!connection.isOpen()) return;
                    try {
                        connection.send(mapper.writeValueAsString(TrackInformation.GetTrainData()));
                    } catch (RejectedExecutionException ignored) {
                        // Server is shutting down.
                    } catch (Exception e) {
                        CreateTrainWebAPIMod.LOGGER.error("Failed to serialize train SSE update", e);
                    }
                }, 0, 200, TimeUnit.MILLISECONDS);

                connection.addCloseTask(conn -> future.cancel(false));
            }).handleRequest(exchange);
        });

        pathHandler.addExactPath("/contraptionsLive", exchange -> {
            addSseHeaders(exchange);
            new ServerSentEventHandler((connection, lastEventId) -> {
                ScheduledFuture<?> future = scheduler.scheduleAtFixedRate(() -> {
                    if (!connection.isOpen()) return;
                    try {
                        connection.send(mapper.writeValueAsString(ContraptionInformation.getContraptions()));
                    } catch (RejectedExecutionException ignored) {
                        // Server is shutting down.
                    } catch (Exception e) {
                        CreateTrainWebAPIMod.LOGGER.error("Failed to serialize contraption SSE update", e);
                    }
                }, 0, 200, TimeUnit.MILLISECONDS);

                connection.addCloseTask(conn -> future.cancel(false));
            }).handleRequest(exchange);
        });

        File trainModelsDir = new File(trainModelPath);
        if (trainModelsDir.exists()) {
            FileResourceManager resourceManager = new FileResourceManager(trainModelsDir, 100);
            ResourceHandler resourceHandler = new ResourceHandler(resourceManager)
                    .setDirectoryListingEnabled(false);
            HttpHandler trainModelHandler = exchange -> {
                exchange.getResponseHeaders().put(new HttpString("Access-Control-Allow-Origin"), "*");
                resourceHandler.handleRequest(exchange);
            };

            pathHandler.addPrefixPath("/trainModels", trainModelHandler);
        }

        server = Undertow.builder()
                .addHttpListener(port, host)
                .setHandler(pathHandler)
                .build();
        server.start();
    }

    private static void addJsonHeaders(io.undertow.server.HttpServerExchange exchange) {
        exchange.getResponseHeaders().put(Headers.CONTENT_TYPE, "application/json; charset=utf-8");
        exchange.getResponseHeaders().put(new HttpString("Access-Control-Allow-Origin"), "*");
    }

    private static void addSseHeaders(io.undertow.server.HttpServerExchange exchange) {
        exchange.getResponseHeaders().put(Headers.CONTENT_TYPE, "text/event-stream; charset=utf-8");
        exchange.getResponseHeaders().put(new HttpString("Access-Control-Allow-Origin"), "*");
        exchange.getResponseHeaders().put(Headers.CACHE_CONTROL, "no-cache");
    }

    public void stop() {
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
        if (server != null) {
            server.stop();
        }
    }
}
