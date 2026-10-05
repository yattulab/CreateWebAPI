package eu.cronmoth.createtrainwebapi;

import com.simibubi.create.content.contraptions.AbstractContraptionEntity;
import com.simibubi.create.content.contraptions.Contraption;
import com.simibubi.create.content.trains.entity.CarriageContraptionEntity;
import eu.cronmoth.createtrainwebapi.model.ContraptionBlockData;
import eu.cronmoth.createtrainwebapi.model.ContraptionData;
import eu.cronmoth.createtrainwebapi.model.ContraptionModelData;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate.StructureBlockInfo;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class ContraptionInformation {
    private static volatile List<ContraptionData> snapshot = List.of();
    private static volatile Map<String, ContraptionModelData> modelSnapshot = Map.of();

    private ContraptionInformation() {
    }

    /**
     * Refreshes the web-facing snapshot from the logical server thread.
     * HTTP/SSE workers only read the immutable snapshots produced here.
     */
    public static void update(MinecraftServer server) {
        List<ContraptionData> contraptions = new ArrayList<>();
        Map<String, ContraptionModelData> models = new HashMap<>();
        Set<String> activeModelIds = new HashSet<>();

        for (ServerLevel level : server.getAllLevels()) {
            for (Entity rawEntity : level.getAllEntities()) {
                if (!(rawEntity instanceof AbstractContraptionEntity entity)) {
                    continue;
                }

                // Train carriages already have the dedicated /trainsLive + /trainModels path.
                if (entity instanceof CarriageContraptionEntity) {
                    continue;
                }

                Contraption contraption = entity.getContraption();
                if (contraption == null || contraption.getBlocks().isEmpty()) {
                    continue;
                }

                ContraptionModelData model = buildModel(contraption);
                activeModelIds.add(model.id);
                models.putIfAbsent(model.id, model);
                contraptions.add(new ContraptionData(entity, model.id));
            }
        }

        contraptions.sort(Comparator.comparing(data -> data.id.toString()));
        snapshot = List.copyOf(contraptions);

        // Keep only models referenced by the current live snapshot.
        models.keySet().retainAll(activeModelIds);
        modelSnapshot = Map.copyOf(models);
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
