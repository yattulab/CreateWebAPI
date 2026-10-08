package eu.cronmoth.createtrainwebapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.simibubi.create.content.contraptions.AbstractContraptionEntity;
import com.simibubi.create.content.contraptions.Contraption;
import com.simibubi.create.content.trains.entity.CarriageContraptionEntity;
import eu.cronmoth.createtrainwebapi.model.ContraptionBlockData;
import eu.cronmoth.createtrainwebapi.model.ContraptionData;
import eu.cronmoth.createtrainwebapi.model.ContraptionModelData;
import eu.cronmoth.createtrainwebapi.model.ContraptionRegistryData;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate.StructureBlockInfo;
import net.minecraft.world.level.storage.LevelResource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.WeakHashMap;

public final class ContraptionInformation {
    private static final ObjectMapper REGISTRY_MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);

    private static volatile List<ContraptionData> snapshot = List.of();
    private static volatile Map<String, ContraptionModelData> modelSnapshot = Map.of();

    private static final Map<UUID, ContraptionData> knownContraptions = new HashMap<>();
    private static final Map<String, ContraptionModelData> knownModels = new HashMap<>();

    // A moving contraption's block structure is normally immutable until it is
    // disassembled. Cache the expensive block-list conversion/hash by object
    // identity and let WeakHashMap release entries after disassembly.
    private static final Map<Contraption, ContraptionModelData> modelCache =
            Collections.synchronizedMap(new WeakHashMap<>());

    private static Path registryPath;
    private static boolean dirty;

    private ContraptionInformation() {
    }

    public static void load(MinecraftServer server) {
        registryPath = server.getWorldPath(LevelResource.ROOT)
                .resolve("data")
                .resolve("createwebapi-contraptions.json");

        knownContraptions.clear();
        knownModels.clear();

        if (Files.isRegularFile(registryPath)) {
            try {
                ContraptionRegistryData registry =
                        REGISTRY_MAPPER.readValue(registryPath.toFile(), ContraptionRegistryData.class);

                if (registry.contraptions != null) {
                    for (ContraptionData data : registry.contraptions) {
                        if (data == null || data.id == null) continue;
                        data.loaded = false;
                        knownContraptions.put(data.id, data);
                    }
                }

                if (registry.models != null) {
                    for (ContraptionModelData model : registry.models) {
                        if (model == null || model.id == null) continue;
                        knownModels.put(model.id, model);
                    }
                }

                CreateTrainWebAPIMod.LOGGER.info(
                        "Loaded {} known contraption(s) and {} model(s)",
                        knownContraptions.size(),
                        knownModels.size()
                );
            } catch (Exception e) {
                CreateTrainWebAPIMod.LOGGER.error(
                        "Failed to load persistent contraption registry from {}",
                        registryPath,
                        e
                );
            }
        }

        dirty = false;
        publishSnapshots();
    }

    /**
     * Refreshes loaded contraptions from the logical server thread while keeping
     * unloaded contraptions at their last known position.
     */
    public static void update(MinecraftServer server) {
        Set<UUID> liveIds = new HashSet<>();
        boolean changed = false;

        for (ServerLevel level : server.getAllLevels()) {
            for (Entity rawEntity : level.getAllEntities()) {
                if (!(rawEntity instanceof AbstractContraptionEntity entity)) {
                    continue;
                }

                // Train carriages already have the dedicated /trainsLive + /trainModels path.
                if (entity instanceof CarriageContraptionEntity) {
                    continue;
                }

                // Physics Assembler vehicles keep internal Create entities in Sable's
                // remote plotyard. The vehicle itself is exported through /vehicles.
                if (SableVehicleInformation.isInsideLoadedVehiclePlot(level, entity.position())) {
                    knownContraptions.remove(entity.getUUID());
                    continue;
                }

                Contraption contraption = entity.getContraption();
                if (contraption == null || contraption.getBlocks().isEmpty()) {
                    continue;
                }

                ContraptionModelData model = getOrBuildModel(contraption);
                knownModels.putIfAbsent(model.id, model);

                ContraptionData data = new ContraptionData(entity, model.id);
                knownContraptions.put(data.id, data);
                liveIds.add(data.id);
                changed = true;
            }
        }

        for (ContraptionData data : knownContraptions.values()) {
            if (!liveIds.contains(data.id) && data.loaded) {
                data.loaded = false;
                changed = true;
            }
        }

        if (changed) {
            dirty = true;
            publishSnapshots();
        }
    }

    /**
     * Called when NeoForge tells us that a contraption entity left a level.
     * Chunk unloads are retained; destroyed/disassembled entities are removed.
     */
    public static void onEntityLeave(AbstractContraptionEntity entity) {
        if (entity instanceof CarriageContraptionEntity) {
            return;
        }

        Entity.RemovalReason reason = entity.getRemovalReason();
        if (reason == null) {
            return;
        }

        if (reason.shouldDestroy()) {
            remove(entity.getUUID());
        } else {
            markUnloaded(entity.getUUID());
        }
    }

    public static void markUnloaded(UUID id) {
        ContraptionData data = knownContraptions.get(id);
        if (data == null || !data.loaded) {
            return;
        }

        data.loaded = false;
        dirty = true;
        publishSnapshots();
    }

    public static void remove(UUID id) {
        ContraptionData removed = knownContraptions.remove(id);
        if (removed == null) {
            return;
        }

        cleanupUnusedModels();
        dirty = true;
        publishSnapshots();
    }

    public static List<ContraptionData> getContraptions() {
        return snapshot;
    }

    public static ContraptionModelData getModel(String id) {
        return modelSnapshot.get(id);
    }

    public static boolean hasModel(String id) {
        return modelSnapshot.containsKey(id);
    }

    /**
     * Persist the last-known registry at a low cadence and on server shutdown.
     */
    public static void save() {
        if (!dirty || registryPath == null) {
            return;
        }

        try {
            Files.createDirectories(registryPath.getParent());

            List<ContraptionData> persistedContraptions = knownContraptions.values()
                    .stream()
                    .map(ContraptionData::new)
                    .sorted(Comparator.comparing(data -> data.id.toString()))
                    .toList();

            // Persisted entries are snapshots, not live entity handles.
            persistedContraptions.forEach(data -> data.loaded = false);

            List<ContraptionModelData> persistedModels = knownModels.values()
                    .stream()
                    .sorted(Comparator.comparing(model -> model.id))
                    .toList();

            ContraptionRegistryData registry =
                    new ContraptionRegistryData(persistedContraptions, persistedModels);

            Path tempPath = registryPath.resolveSibling(registryPath.getFileName() + ".tmp");
            REGISTRY_MAPPER.writeValue(tempPath.toFile(), registry);

            try {
                Files.move(
                        tempPath,
                        registryPath,
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE
                );
            } catch (IOException atomicMoveUnsupported) {
                Files.move(
                        tempPath,
                        registryPath,
                        StandardCopyOption.REPLACE_EXISTING
                );
            }

            dirty = false;
        } catch (Exception e) {
            CreateTrainWebAPIMod.LOGGER.error(
                    "Failed to save persistent contraption registry to {}",
                    registryPath,
                    e
            );
        }
    }

    private static void publishSnapshots() {
        List<ContraptionData> data = knownContraptions.values()
                .stream()
                .map(ContraptionData::new)
                .sorted(Comparator.comparing(item -> item.id.toString()))
                .toList();

        snapshot = List.copyOf(data);
        modelSnapshot = Map.copyOf(knownModels);
    }

    private static void cleanupUnusedModels() {
        Set<String> referenced = new HashSet<>();
        for (ContraptionData data : knownContraptions.values()) {
            if (data.modelId != null) referenced.add(data.modelId);
        }
        knownModels.keySet().retainAll(referenced);
    }

    private static ContraptionModelData getOrBuildModel(Contraption contraption) {
        synchronized (modelCache) {
            return modelCache.computeIfAbsent(contraption, ContraptionInformation::buildModel);
        }
    }

    private static ContraptionModelData buildModel(Contraption contraption) {
        List<ContraptionBlockData> blocks = contraption.getBlocks()
                .values()
                .stream()
                .sorted(Comparator.comparing((StructureBlockInfo info) -> info.pos().getX())
                        .thenComparing(info -> info.pos().getY())
                        .thenComparing(info -> info.pos().getZ()))
                .map(ContraptionBlockData::new)
                .toList();

        String modelId = hashBlocks(blocks);
        return new ContraptionModelData(modelId, blocks);
    }

    private static String hashBlocks(List<ContraptionBlockData> blocks) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (ContraptionBlockData block : blocks) {
                digest.update(block.hashKey().getBytes(StandardCharsets.UTF_8));
                digest.update((byte) '\n');
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
