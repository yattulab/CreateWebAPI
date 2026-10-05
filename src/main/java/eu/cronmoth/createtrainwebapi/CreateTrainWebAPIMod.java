package eu.cronmoth.createtrainwebapi;

import com.mojang.logging.LogUtils;
import com.simibubi.create.content.contraptions.AbstractContraptionEntity;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.EntityLeaveLevelEvent;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import org.slf4j.Logger;

@Mod(CreateTrainWebAPIMod.MODID)
public class CreateTrainWebAPIMod {
    public static final String MODID = "createtrainwebapi";
    public static final Logger LOGGER = LogUtils.getLogger();

    private final ApiServer apiServer = new ApiServer();
    private int contraptionSnapshotTicks = 0;
    private int contraptionSaveTicks = 0;

    public CreateTrainWebAPIMod(IEventBus modEventBus, ModContainer modContainer) {
        NeoForge.EVENT_BUS.register(this);
        modContainer.registerConfig(ModConfig.Type.COMMON, Config.SPEC);
    }

    @SubscribeEvent
    public void onServerStarting(ServerStartingEvent event) {
        ContraptionInformation.load(event.getServer());
        SableVehicleInformation.load(event.getServer());

        String host = Config.SERVER_HOST.get();
        int port = Config.SERVER_PORT.get();
        String trainModelPath = Config.TRAIN_MODEL_PATH.get();
        apiServer.start(host, port, trainModelPath);
    }

    @SubscribeEvent
    public void onServerTick(ServerTickEvent.Post event) {
        // 20 TPS / 4 ticks = 5 snapshots per second, matching the 200 ms SSE cadence.
        if (++contraptionSnapshotTicks >= 4) {
            contraptionSnapshotTicks = 0;
            ContraptionInformation.update(event.getServer());
            SableVehicleInformation.update(event.getServer());
        }

        // Persist the last-known positions at a low cadence. Chunk unload itself
        // does not force the chunk to stay loaded.
        if (++contraptionSaveTicks >= 100) {
            contraptionSaveTicks = 0;
            ContraptionInformation.save();
            SableVehicleInformation.save();
        }
    }

    @SubscribeEvent
    public void onEntityLeaveLevel(EntityLeaveLevelEvent event) {
        if (event.getLevel().isClientSide()) {
            return;
        }
        if (event.getEntity() instanceof AbstractContraptionEntity entity) {
            ContraptionInformation.onEntityLeave(entity);
        }
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        ContraptionInformation.save();
        SableVehicleInformation.save();
        apiServer.stop();
    }
}
