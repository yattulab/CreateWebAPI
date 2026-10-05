package eu.cronmoth.createtrainwebapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import eu.cronmoth.createtrainwebapi.model.ContraptionBlockData;
import eu.cronmoth.createtrainwebapi.model.VehicleData;
import eu.cronmoth.createtrainwebapi.model.VehicleModelData;
import eu.cronmoth.createtrainwebapi.model.VehicleRegistryData;
import net.minecraft.core.BlockPos;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;
import net.neoforged.fml.ModList;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class SableVehicleInformation {
    private static final long MODEL_REFRESH_INTERVAL_MS = 30_000L;

    private static final ObjectMapper REGISTRY_MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);

    private static volatile List<VehicleData> snapshot = List.of();
    private static volatile Map<String, VehicleModelData> modelSnapshot = Map.of();

    private static final Map<UUID, VehicleData> knownVehicles = new HashMap<>();
    private static final Map<String, VehicleModelData> knownModels = new HashMap<>();
    private static final Map<UUID, CachedModel> modelCache = new HashMap<>();

    private static final Set<Object> observedContainers =
            Collections.newSetFromMap(new IdentityHashMap<>());

    private static Path registryPath;
    private static boolean dirty;
    private static boolean sableAvailable;
    private static Class<?> subLevelContainerClass;
    private static Class<?> subLevelObserverClass;

    private SableVehicleInformation() {
    }

    public static void load(MinecraftServer server) {
        registryPath = server.getWorldPath(LevelResource.ROOT)
                .resolve("data")
                .resolve("createwebapi-vehicles.json");

        knownVehicles.clear();
        knownModels.clear();
        modelCache.clear();
        observedContainers.clear();

        sableAvailable = detectSable();

        if (Files.isRegularFile(registryPath)) {
            try {
                VehicleRegistryData registry =
                        REGISTRY_MAPPER.readValue(registryPath.toFile(), VehicleRegistryData.class);

                if (registry.vehicles != null) {
                    for (VehicleData data : registry.vehicles) {
                        if (data == null || data.id == null) continue;
                        data.loaded = false;
                        knownVehicles.put(data.id, data);
                    }
                }

                if (registry.models != null) {
                    for (VehicleModelData model : registry.models) {
                        if (model == null || model.id == null) continue;
                        knownModels.put(model.id, model);
                    }
                }
            } catch (Exception e) {
                CreateTrainWebAPIMod.LOGGER.error(
                        "Failed to load Sable vehicle registry from {}",
                        registryPath,
                        e
                );
            }
        }

        if (sableAvailable) {
            CreateTrainWebAPIMod.LOGGER.info(
                    "Sable vehicle integration enabled ({} known vehicle(s), {} model(s))",
                    knownVehicles.size(),
                    knownModels.size()
            );
        } else {
            CreateTrainWebAPIMod.LOGGER.info("Sable not detected; vehicle API will remain empty");
        }

        dirty = false;
        publishSnapshots();
    }

    public static void update(MinecraftServer server) {
        if (!sableAvailable) {
            return;
        }

        final long now = System.currentTimeMillis();
        Set<UUID> liveIds = new HashSet<>();
        boolean changed = false;

        for (ServerLevel level : server.getAllLevels()) {
            Object container = getContainer(level);
            if (container == null) continue;

            ensureObserver(container);

            for (Object subLevel : getAllSubLevels(container)) {
                try {
                    UUID id = (UUID) invoke(subLevel, "getUniqueId");
                    if (id == null) continue;

                    VehicleModelData model = getOrBuildModel(level, subLevel, id, now);
                    if (model == null || model.blocks == null || model.blocks.isEmpty()) {
                        continue;
                    }

                    knownModels.put(model.id, model);

                    VehicleData data = readVehicleData(level, subLevel, id, model.id, now);
                    knownVehicles.put(id, data);
                    liveIds.add(id);
                    changed = true;
                } catch (Exception e) {
                    CreateTrainWebAPIMod.LOGGER.debug(
                            "Failed to inspect one Sable sub-level",
                            e
                    );
                }
            }
        }

        for (VehicleData data : knownVehicles.values()) {
            if (!liveIds.contains(data.id) && data.loaded) {
                data.loaded = false;
                changed = true;
            }
        }

        if (changed) {
            dirty = true;
            cleanupUnusedModels();
            publishSnapshots();
        }
    }

    public static List<VehicleData> getVehicles() {
        return snapshot;
    }

    public static VehicleModelData getModel(String id) {
        return modelSnapshot.get(id);
    }

    public static boolean isSableAvailable() {
        return sableAvailable;
    }

    /**
     * Returns true if a normal Create entity is stored inside a loaded Sable
     * plotyard. Such entities are internals of a physics vehicle and should not
     * be exposed as independent /contraptions entries.
     */
    public static boolean isInsideLoadedVehiclePlot(ServerLevel level, Vec3 position) {
        if (!sableAvailable) return false;

        Object container = getContainer(level);
        if (container == null) return false;

        for (Object subLevel : getAllSubLevels(container)) {
            try {
                Object plot = invoke(subLevel, "getPlot");
                Object result = invoke(plot, "contains", position);
                if (result instanceof Boolean b && b) {
                    return true;
                }
            } catch (Exception ignored) {
            }
        }

        return false;
    }

    public static void save() {
        if (!dirty || registryPath == null) {
            return;
        }

        try {
            Files.createDirectories(registryPath.getParent());

            List<VehicleData> vehicles = knownVehicles.values()
                    .stream()
                    .map(VehicleData::new)
                    .sorted(Comparator.comparing(data -> data.id.toString()))
                    .toList();

            vehicles.forEach(data -> data.loaded = false);

            List<VehicleModelData> models = knownModels.values()
                    .stream()
                    .sorted(Comparator.comparing(model -> model.id))
                    .toList();

            Path tempPath = registryPath.resolveSibling(registryPath.getFileName() + ".tmp");
            REGISTRY_MAPPER.writeValue(
                    tempPath.toFile(),
                    new VehicleRegistryData(vehicles, models)
            );

            try {
                Files.move(
                        tempPath,
                        registryPath,
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE
                );
            } catch (IOException atomicMoveUnsupported) {
                Files.move(tempPath, registryPath, StandardCopyOption.REPLACE_EXISTING);
            }

            dirty = false;
        } catch (Exception e) {
            CreateTrainWebAPIMod.LOGGER.error(
                    "Failed to save Sable vehicle registry to {}",
                    registryPath,
                    e
            );
        }
    }

    private static boolean detectSable() {
        if (!ModList.get().isLoaded("sable")) {
            return false;
        }

        try {
            subLevelContainerClass =
                    Class.forName("dev.ryanhcode.sable.api.sublevel.SubLevelContainer");
            subLevelObserverClass =
                    Class.forName("dev.ryanhcode.sable.api.sublevel.SubLevelObserver");
            return true;
        } catch (ClassNotFoundException e) {
            CreateTrainWebAPIMod.LOGGER.warn(
                    "Sable is loaded but its public SubLevel API was not found"
            );
            return false;
        }
    }

    private static VehicleData readVehicleData(
            ServerLevel level,
            Object subLevel,
            UUID id,
            String modelId,
            long now
    ) throws Exception {
        Object pose = invoke(subLevel, "logicalPose");
        Object position = invoke(pose, "position");
        Object orientation = invoke(pose, "orientation");
        Object scale = invoke(pose, "scale");

        VehicleData data = new VehicleData();
        data.id = id;
        data.dimension = level.dimension().location().toString();

        Object name = invoke(subLevel, "getName");
        data.name = name == null ? null : String.valueOf(name);
        data.modelId = modelId;

        data.x = component(position, "x");
        data.y = component(position, "y");
        data.z = component(position, "z");

        data.quaternionX = component(orientation, "x");
        data.quaternionY = component(orientation, "y");
        data.quaternionZ = component(orientation, "z");
        data.quaternionW = component(orientation, "w");

        data.scaleX = component(scale, "x");
        data.scaleY = component(scale, "y");
        data.scaleZ = component(scale, "z");

        data.loaded = true;
        data.lastSeen = now;
        return data;
    }

    private static VehicleModelData getOrBuildModel(
            ServerLevel level,
            Object subLevel,
            UUID id,
            long now
    ) throws Exception {
        CachedModel cached = modelCache.get(id);
        if (cached != null && now < cached.rebuildAfter) {
            return cached.model;
        }

        VehicleModelData model = buildModel(level, subLevel);
        modelCache.put(id, new CachedModel(model, now + MODEL_REFRESH_INTERVAL_MS));
        return model;
    }

    private static VehicleModelData buildModel(ServerLevel level, Object subLevel) throws Exception {
        Object plot = invoke(subLevel, "getPlot");
        BlockPos center = (BlockPos) invoke(plot, "getCenterBlock");

        Object pose = invoke(subLevel, "logicalPose");
        Object rotationPoint = invoke(pose, "rotationPoint");

        double originOffsetX = center.getX() - component(rotationPoint, "x");
        double originOffsetY = center.getY() - component(rotationPoint, "y");
        double originOffsetZ = center.getZ() - component(rotationPoint, "z");

        List<ContraptionBlockData> blocks = new ArrayList<>();

        Object loadedChunksObject = invoke(plot, "getLoadedChunks");
        if (!(loadedChunksObject instanceof Collection<?> loadedChunks)) {
            return null;
        }

        for (Object holder : loadedChunks) {
            Object chunkObject = invoke(holder, "getChunk");
            if (!(chunkObject instanceof LevelChunk chunk)) continue;

            ChunkPos chunkPos = chunk.getPos();
            LevelChunkSection[] sections = chunk.getSections();

            for (int sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
                LevelChunkSection section = sections[sectionIndex];
                if (section == null || section.hasOnlyAir()) continue;

                int minY = chunk.getSectionYFromSectionIndex(sectionIndex) << 4;

                for (int localX = 0; localX < 16; localX++) {
                    for (int localY = 0; localY < 16; localY++) {
                        for (int localZ = 0; localZ < 16; localZ++) {
                            BlockState state = section.getBlockState(localX, localY, localZ);
                            if (state.isAir()) continue;

                            int globalX = chunkPos.getMinBlockX() + localX;
                            int globalY = minY + localY;
                            int globalZ = chunkPos.getMinBlockZ() + localZ;

                            blocks.add(new ContraptionBlockData(
                                    globalX - center.getX(),
                                    globalY - center.getY(),
                                    globalZ - center.getZ(),
                                    state
                            ));
                        }
                    }
                }
            }
        }

        blocks.sort(
                Comparator.comparingInt((ContraptionBlockData block) -> block.x)
                        .thenComparingInt(block -> block.y)
                        .thenComparingInt(block -> block.z)
                        .thenComparing(block -> block.block)
        );

        String modelId = hashModel(
                originOffsetX,
                originOffsetY,
                originOffsetZ,
                blocks
        );

        return new VehicleModelData(
                modelId,
                originOffsetX,
                originOffsetY,
                originOffsetZ,
                blocks
        );
    }

    private static String hashModel(
            double originOffsetX,
            double originOffsetY,
            double originOffsetZ,
            List<ContraptionBlockData> blocks
    ) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(Double.toHexString(originOffsetX).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) '|');
            digest.update(Double.toHexString(originOffsetY).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) '|');
            digest.update(Double.toHexString(originOffsetZ).getBytes(StandardCharsets.UTF_8));
            digest.update((byte) '\n');

            for (ContraptionBlockData block : blocks) {
                digest.update(block.hashKey().getBytes(StandardCharsets.UTF_8));
                digest.update((byte) '\n');
            }

            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static void ensureObserver(Object container) {
        if (observedContainers.contains(container)) {
            return;
        }

        try {
            Object observer = Proxy.newProxyInstance(
                    subLevelObserverClass.getClassLoader(),
                    new Class<?>[]{subLevelObserverClass},
                    (proxy, method, args) -> {
                        String methodName = method.getName();

                        if ("onSubLevelRemoved".equals(methodName) && args != null && args.length >= 2) {
                            Object subLevel = args[0];
                            Object reason = args[1];
                            try {
                                UUID id = (UUID) invoke(subLevel, "getUniqueId");
                                if ("REMOVED".equals(String.valueOf(reason))) {
                                    removeVehicle(id);
                                } else {
                                    markVehicleUnloaded(id);
                                }
                            } catch (Exception e) {
                                CreateTrainWebAPIMod.LOGGER.debug(
                                        "Failed to process Sable sub-level removal",
                                        e
                                );
                            }
                            return null;
                        }

                        if ("toString".equals(methodName)) {
                            return "CreateWebAPI Sable vehicle observer";
                        }
                        if ("hashCode".equals(methodName)) {
                            return System.identityHashCode(proxy);
                        }
                        if ("equals".equals(methodName)) {
                            return proxy == (args == null ? null : args[0]);
                        }

                        return null;
                    }
            );

            invoke(container, "addObserver", observer);
            observedContainers.add(container);
        } catch (Exception e) {
            CreateTrainWebAPIMod.LOGGER.warn(
                    "Could not register Sable vehicle lifecycle observer; unloaded vehicles will still be cached, but permanent removals may require a restart cleanup",
                    e
            );
            observedContainers.add(container);
        }
    }

    private static void removeVehicle(UUID id) {
        VehicleData removed = knownVehicles.remove(id);
        modelCache.remove(id);
        if (removed == null) return;

        cleanupUnusedModels();
        dirty = true;
        publishSnapshots();
    }

    private static void markVehicleUnloaded(UUID id) {
        VehicleData data = knownVehicles.get(id);
        if (data == null || !data.loaded) return;

        data.loaded = false;
        dirty = true;
        publishSnapshots();
    }

    private static void cleanupUnusedModels() {
        Set<String> referenced = new HashSet<>();
        for (VehicleData data : knownVehicles.values()) {
            if (data.modelId != null) {
                referenced.add(data.modelId);
            }
        }
        knownModels.keySet().retainAll(referenced);
    }

    private static void publishSnapshots() {
        snapshot = knownVehicles.values()
                .stream()
                .map(VehicleData::new)
                .sorted(Comparator.comparing(data -> data.id.toString()))
                .toList();

        modelSnapshot = Map.copyOf(knownModels);
    }

    private static Object getContainer(ServerLevel level) {
        if (!sableAvailable || subLevelContainerClass == null) {
            return null;
        }

        try {
            Method method = subLevelContainerClass.getMethod("getContainer", ServerLevel.class);
            return method.invoke(null, level);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<?> getAllSubLevels(Object container) {
        try {
            Object value = invoke(container, "getAllSubLevels");
            return value instanceof List<?> list ? list : List.of();
        } catch (Exception e) {
            return List.of();
        }
    }

    private static Object invoke(Object target, String methodName, Object... args) throws Exception {
        Method best = null;

        for (Method method : target.getClass().getMethods()) {
            if (!method.getName().equals(methodName)) continue;
            if (method.getParameterCount() != args.length) continue;

            Class<?>[] parameterTypes = method.getParameterTypes();
            boolean compatible = true;

            for (int i = 0; i < parameterTypes.length; i++) {
                Object arg = args[i];
                if (arg == null) continue;
                if (!parameterTypes[i].isAssignableFrom(arg.getClass())) {
                    compatible = false;
                    break;
                }
            }

            if (compatible) {
                best = method;
                break;
            }
        }

        if (best == null) {
            throw new NoSuchMethodException(
                    target.getClass().getName() + "#" + methodName
            );
        }

        return best.invoke(target, args);
    }

    private static double component(Object vector, String methodName) throws Exception {
        Object value = invoke(vector, methodName);
        if (!(value instanceof Number number)) {
            throw new IllegalStateException(
                    vector.getClass().getName() + "#" + methodName + " did not return a number"
            );
        }
        return number.doubleValue();
    }

    private record CachedModel(VehicleModelData model, long rebuildAfter) {
    }
}
