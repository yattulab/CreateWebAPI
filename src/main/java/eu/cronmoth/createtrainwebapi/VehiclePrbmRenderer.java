package eu.cronmoth.createtrainwebapi;

import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.common.api.BlueMapAPIImpl;
import de.bluecolored.bluemap.core.map.BmMap;
import de.bluecolored.bluemap.core.map.TextureGallery;
import de.bluecolored.bluemap.core.map.hires.ArrayTileModel;
import de.bluecolored.bluemap.core.map.hires.PRBMWriter;
import de.bluecolored.bluemap.core.map.hires.RenderSettings;
import de.bluecolored.bluemap.core.map.hires.TileModelView;
import de.bluecolored.bluemap.core.map.hires.block.BlockStateModelRenderer;
import de.bluecolored.bluemap.core.resources.pack.resourcepack.ResourcePack;
import de.bluecolored.bluemap.core.util.math.Color;
import de.bluecolored.bluemap.core.util.math.MatrixM4f;
import de.bluecolored.bluemap.core.world.BlockEntity;
import de.bluecolored.bluemap.core.world.BlockState;
import de.bluecolored.bluemap.core.world.LightData;
import de.bluecolored.bluemap.core.world.biome.Biome;
import de.bluecolored.bluemap.core.world.block.BlockAccess;
import de.bluecolored.bluemap.core.world.block.BlockNeighborhood;
import de.bluecolored.bluemap.core.world.mca.MCAWorld;
import eu.cronmoth.createtrainwebapi.model.ContraptionBlockData;
import eu.cronmoth.createtrainwebapi.model.VehicleModelData;
import net.neoforged.fml.ModList;
import org.jetbrains.annotations.Nullable;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Builds BlueMap PRBM geometry for Sable physics vehicles.
 *
 * The geometry is rendered in the vehicle's local coordinate system. Sable's
 * live position, orientation and scale remain separate and are applied by the
 * browser, so a single PRBM can be reused while the vehicle moves.
 */
public final class VehiclePrbmRenderer {
    private static final AtomicBoolean INSTALLED = new AtomicBoolean(false);
    private static final List<BmMap> MAPS = new CopyOnWriteArrayList<>();
    private static final Map<String, byte[]> CACHE = new ConcurrentHashMap<>();
    private static final Object RENDER_LOCK = new Object();

    private VehiclePrbmRenderer() {
    }

    public static void install() {
        if (!INSTALLED.compareAndSet(false, true)) {
            return;
        }

        if (!ModList.get().isLoaded("bluemap")) {
            CreateTrainWebAPIMod.LOGGER.info(
                    "BlueMap is not loaded; textured Sable vehicle PRBM rendering is disabled"
            );
            return;
        }

        try {
            BlueMapAPI.onEnable(api -> {
                MAPS.clear();
                CACHE.clear();

                if (api instanceof BlueMapAPIImpl impl) {
                    MAPS.addAll(impl.blueMapService().getMaps().values());
                    CreateTrainWebAPIMod.LOGGER.info(
                            "BlueMap vehicle PRBM renderer ready with {} map(s)",
                            MAPS.size()
                    );
                } else {
                    CreateTrainWebAPIMod.LOGGER.warn(
                            "BlueMap API implementation does not expose internal map render resources; vehicle PRBM rendering is unavailable"
                    );
                }
            });

            BlueMapAPI.onDisable(api -> {
                MAPS.clear();
                CACHE.clear();
            });
        } catch (LinkageError error) {
            CreateTrainWebAPIMod.LOGGER.error(
                    "Failed to initialize BlueMap vehicle PRBM integration",
                    error
            );
        }
    }

    public static boolean isReady() {
        return !MAPS.isEmpty();
    }

    public static @Nullable byte[] getOrCreate(String modelId, String dimension) {
        byte[] cached = CACHE.get(modelId);
        if (cached != null) {
            return cached;
        }

        VehicleModelData model = SableVehicleInformation.getModel(modelId);
        if (model == null || model.blocks == null || model.blocks.isEmpty()) {
            return null;
        }

        BmMap map = findMap(dimension);
        if (map == null) {
            return null;
        }

        synchronized (RENDER_LOCK) {
            cached = CACHE.get(modelId);
            if (cached != null) {
                return cached;
            }

            try {
                byte[] prbm = render(map, model);
                CACHE.put(modelId, prbm);
                return prbm;
            } catch (Throwable error) {
                CreateTrainWebAPIMod.LOGGER.error(
                        "Failed to render BlueMap PRBM for Sable vehicle model {}",
                        modelId,
                        error
                );
                return null;
            }
        }
    }

    public static void clearCache() {
        CACHE.clear();
    }

    private static @Nullable BmMap findMap(String dimension) {
        if (MAPS.isEmpty()) {
            return null;
        }

        String wanted = normalizeDimension(dimension);
        for (BmMap map : MAPS) {
            try {
                if (map.getWorld() instanceof MCAWorld world) {
                    String mapDimension = normalizeDimension(
                            world.getDimension().getKey().getValue()
                    );
                    if (wanted.equals(mapDimension)) {
                        return map;
                    }
                }
            } catch (Throwable ignored) {
            }
        }

        // Resource packs and texture galleries are normally shared across maps,
        // so a loaded map is still a useful fallback for custom dimensions.
        return MAPS.getFirst();
    }

    private static String normalizeDimension(String dimension) {
        String value = dimension == null ? "" : dimension.toLowerCase();

        if (value.contains("the_nether") || value.equals("nether")) {
            return "minecraft:the_nether";
        }
        if (value.contains("the_end") || value.equals("end")) {
            return "minecraft:the_end";
        }
        if (value.contains("overworld") || value.equals("world")) {
            return "minecraft:overworld";
        }

        return value;
    }

    private static byte[] render(BmMap map, VehicleModelData model) throws IOException {
        ResourcePack resourcePack = map.getResourcePack();
        TextureGallery textureGallery = map.getTextureGallery();
        RenderSettings renderSettings = map.getMapSettings();

        BlockStateModelRenderer renderer =
                new BlockStateModelRenderer(resourcePack, textureGallery, renderSettings);

        VehicleBlockAccess access = new VehicleBlockAccess(model);
        BlockNeighborhood neighborhood = new BlockNeighborhood(
                access,
                resourcePack,
                renderSettings,
                map.getWorld().getDimensionType()
        );

        // ArrayTileModel grows automatically. This only avoids repeated small reallocations.
        int initialFaces = Math.max(100, Math.min(100_000, model.blockCount * 12));
        ArrayTileModel tileModel = new ArrayTileModel(initialFaces);
        TileModelView view = new TileModelView(tileModel);
        Color color = new Color();

        int modelStart = view.initialize().getStart();

        for (ContraptionBlockData block : model.blocks) {
            // BlockNeighborhood caches coordinates modulo 8. Move to an adjacent
            // coordinate first so the next set() always refreshes the current block.
            neighborhood.set(block.x + 1, block.y, block.z);
            neighborhood.set(block.x, block.y, block.z);

            view.initialize();
            renderer.render(neighborhood, view, color);
            view.translate(block.x, block.y, block.z);
        }

        view.initialize(modelStart);

        // VehicleModelData stores blocks relative to the plot center while
        // Sable rotates around rotationPoint. Bake only that local pivot offset
        // into the PRBM; live world pose is applied in vehicles.js.
        MatrixM4f pivotOffset = new MatrixM4f()
                .identity()
                .translate(
                        (float) model.originOffsetX,
                        (float) model.originOffsetY,
                        (float) model.originOffsetZ
                );
        view.transform(pivotOffset);

        ByteArrayOutputStream output = new ByteArrayOutputStream();
        new PRBMWriter(output).write(tileModel);
        return output.toByteArray();
    }

    private static final class VehicleBlockAccess implements BlockAccess {
        private static final int OFFSET = 1 << 20;
        private static final long MASK = (1L << 21) - 1;

        private final Map<Long, BlockState> blocks;
        private int x;
        private int y;
        private int z;

        VehicleBlockAccess(VehicleModelData model) {
            this.blocks = new ConcurrentHashMap<>(Math.max(16, model.blockCount * 2));

            for (ContraptionBlockData block : model.blocks) {
                Map<String, String> properties =
                        block.properties == null ? Map.of() : new TreeMap<>(block.properties);

                BlockState state = properties.isEmpty()
                        ? new BlockState(block.block)
                        : new BlockState(block.block, properties);

                blocks.put(key(block.x, block.y, block.z), state);
            }
        }

        private VehicleBlockAccess(Map<Long, BlockState> blocks, int x, int y, int z) {
            this.blocks = blocks;
            this.x = x;
            this.y = y;
            this.z = z;
        }

        @Override
        public void set(int x, int y, int z) {
            this.x = x;
            this.y = y;
            this.z = z;
        }

        @Override
        public int getX() {
            return x;
        }

        @Override
        public int getY() {
            return y;
        }

        @Override
        public int getZ() {
            return z;
        }

        @Override
        public BlockAccess copy() {
            return new VehicleBlockAccess(blocks, x, y, z);
        }

        @Override
        public BlockState getBlockState() {
            return blocks.getOrDefault(key(x, y, z), BlockState.AIR);
        }

        @Override
        public LightData getLightData() {
            return new LightData(15, 0);
        }

        @Override
        public Biome getBiome() {
            return Biome.DEFAULT;
        }

        @Override
        public @Nullable BlockEntity getBlockEntity() {
            return null;
        }

        @Override
        public boolean hasOceanFloorY() {
            return false;
        }

        @Override
        public int getOceanFloorY() {
            return 0;
        }

        private static long key(int x, int y, int z) {
            return (((long) (x + OFFSET) & MASK) << 42)
                    | (((long) (y + OFFSET) & MASK) << 21)
                    | ((long) (z + OFFSET) & MASK);
        }
    }
}
