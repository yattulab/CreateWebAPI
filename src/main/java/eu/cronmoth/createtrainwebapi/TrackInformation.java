package eu.cronmoth.createtrainwebapi;

import com.simibubi.create.Create;
import com.simibubi.create.content.trains.GlobalRailwayManager;
import com.simibubi.create.content.trains.entity.Train;
import com.simibubi.create.content.trains.graph.TrackEdge;
import com.simibubi.create.content.trains.graph.TrackGraph;
import com.simibubi.create.content.trains.graph.TrackNode;
import com.simibubi.create.content.trains.graph.TrackNodeLocation;
import com.simibubi.create.content.trains.signal.SignalBlock;
import com.simibubi.create.content.trains.signal.SignalBoundary;
import com.simibubi.create.content.trains.signal.SignalEdgeGroup;
import com.simibubi.create.content.trains.signal.TrackEdgePoint;
import com.simibubi.create.content.trains.station.GlobalStation;
import eu.cronmoth.createtrainwebapi.model.*;

import java.util.*;

public class TrackInformation {
    public static GlobalRailwayManager railway = Create.RAILWAYS;

    // HTTP and SSE threads must not traverse live Create railway objects.
    // A snapshot is captured on the Minecraft server thread every four ticks.
    private static volatile List<TrainData> trainSnapshot = List.of();
    private static long lastTrainErrorLogMillis = 0L;
    private static int lastTrainCount = -1;

    public static List<TrainData> GetTrainData() {
        return trainSnapshot;
    }

    public static void updateTrainSnapshot() {
        final long now = System.currentTimeMillis();
        final List<TrainData> next = new ArrayList<>();

        try {
            Map<UUID, Train> trains = railway.trains;
            if (trains == null) {
                return;
            }

            // Preserve the last usable snapshot of an individual train if a
            // mod transiently leaves it in an inconsistent state.
            Map<UUID, TrainData> previousById = new HashMap<>();
            for (TrainData data : trainSnapshot) {
                previousById.put(data.id, data);
            }

            for (Map.Entry<UUID, Train> entry : trains.entrySet()) {
                UUID trainId = entry.getKey();
                Train train = entry.getValue();

                if (train == null) {
                    continue;
                }

                try {
                    next.add(new TrainData(train));
                } catch (RuntimeException | LinkageError error) {
                    TrainData previous = previousById.get(trainId);
                    if (previous != null) {
                        next.add(previous);
                    }
                    if (now - lastTrainErrorLogMillis >= 30_000) {
                        lastTrainErrorLogMillis = now;
                        CreateTrainWebAPIMod.LOGGER.warn(
                                "Failed to snapshot Create train {}; retaining last valid data if available",
                                trainId,
                                error
                        );
                    }
                }
            }

            trainSnapshot = List.copyOf(next);

            if (lastTrainCount != next.size()) {
                lastTrainCount = next.size();
                CreateTrainWebAPIMod.LOGGER.info(
                        "Create train snapshot contains {} train(s)",
                        lastTrainCount
                );
            }
        } catch (RuntimeException | LinkageError error) {
            if (now - lastTrainErrorLogMillis >= 30_000) {
                lastTrainErrorLogMillis = now;
                CreateTrainWebAPIMod.LOGGER.error(
                        "Could not refresh Create train snapshot; keeping the previous data",
                        error
                );
            }
        }
    }

    public static NetworkData GetNetworkData() {
        Map<UUID, TrackGraph> graphs = railway.trackNetworks;
        // For each graph, extract nodes and edges
        Set<NodeData> nodes = new HashSet<>();
        Set<EdgeData> edges = new HashSet<>();
        Set<StationData> stations = new HashSet<>();
        for (UUID uuid : graphs.keySet()) {
            TrackGraph trackGraph = graphs.get(uuid);
            Set<TrackNodeLocation> trackNodes = trackGraph.getNodes();
            Set<EdgeWrapper> trackEdges = new HashSet<>();
            // For each node, extract its data and connected edges
            for (TrackNodeLocation trackNodeLocation : trackNodes) {
                TrackNode node = trackGraph.locateNode(trackNodeLocation);
                NodeData nodeData = new NodeData(node);
                nodes.add(nodeData);
                Map<TrackNode, TrackEdge> nodeEdgeMap = trackGraph.getConnectionsFrom(node);
                // Find all edges
                for (TrackEdge trackEdge : nodeEdgeMap.values()) {
                    trackEdges.add(new EdgeWrapper(trackEdge));
                    if (trackEdge.isInterDimensional()) {
                        nodeData.interDimensional = true;
                    }
                }
            }
            for (EdgeWrapper edgeWrapper : trackEdges) {
                TrackEdge trackEdge = edgeWrapper.trackEdge;
                List<TrackEdgePoint> edgePoints = trackEdge.getEdgeData().getPoints();
                boolean forward = true;
                boolean backward = true;
                // Determine directionality based on edge points
                for (TrackEdgePoint trackEdgePoint : edgePoints) {
                    if (trackEdgePoint instanceof GlobalStation) {
                        GlobalStation station = (GlobalStation) trackEdgePoint;
                        stations.add(new StationData(station, trackGraph));
                    }
                    else if (trackEdgePoint instanceof SignalBoundary) {
                        //Block Entity Maps hold enttities for each direction. CanNavigate checks if both direction are set.
                        SignalBoundary signalBoundary = (SignalBoundary) trackEdgePoint;
                        if (signalBoundary.blockEntities.either(Map::isEmpty)) {
                            forward = !signalBoundary.canNavigateVia(trackEdge.node1);
                            backward = !signalBoundary.canNavigateVia(trackEdge.node2);
                        }
                    }
                }
                edges.add(new EdgeData(trackEdge, forward, backward));
            }

        }
        return new NetworkData(nodes, edges, stations);
    }
}
