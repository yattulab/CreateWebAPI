package eu.cronmoth.createtrainwebapi.model;

import com.simibubi.create.content.trains.entity.Carriage;
import com.simibubi.create.content.trains.entity.TravellingPoint;
import net.minecraft.nbt.CompoundTag;

import java.lang.reflect.Field;

/**
 * Lightweight, immutable-after-construction snapshot of one Create carriage.
 *
 * A carriage may temporarily have detached/unresolved TravellingPoints while
 * loading or migrating to another graph. Do not let one missing TrackNode
 * bring down the entire train HTTP/SSE response.
 *
 * Node IDs of -1 indicate that a position is not currently resolvable.
 * The existing BlueMap frontend ignores such a carriage until it can be
 * placed on valid network nodes again.
 */
public class TrainCarData {
    public int id;
    public double positionOnTrack;
    public String assemblyDirection;

    public int node1;
    public int node2;

    public double trailingPositionOnTrack;
    public int node3;
    public int node4;

    public TrainCarData(Carriage carriage) {
        id = carriage == null ? -1 : carriage.id;

        // Do not use Java's default 0: a valid rail node can have ID zero.
        node1 = -1;
        node2 = -1;
        node3 = -1;
        node4 = -1;
        assemblyDirection = "SOUTH";

        if (carriage == null) {
            return;
        }

        // Read both points as one coherent pair. A half-initialized carriage
        // must not accidentally snap to unrelated network nodes.
        try {
            TravellingPoint leading = carriage.getLeadingPoint();
            TravellingPoint trailing = carriage.getTrailingPoint();

            if (leading != null && leading.node1 != null && leading.node2 != null
                    && trailing != null && trailing.node1 != null && trailing.node2 != null) {
                positionOnTrack = leading.position;
                node1 = leading.node1.getNetId();
                node2 = leading.node2.getNetId();
                trailingPositionOnTrack = trailing.position;
                node3 = trailing.node1.getNetId();
                node4 = trailing.node2.getNetId();
            }
        } catch (RuntimeException ignored) {
            // Train migration / temporary carriage state: leave all nodes -1.
            node1 = node2 = node3 = node4 = -1;
        }

        // This legacy field is used only to orient the PRBM model.
        // It must be best-effort: a missing/switching entity NBT is not fatal.
        try {
            Field field = Carriage.class.getDeclaredField("serialisedEntity");
            field.setAccessible(true);
            Object raw = field.get(carriage);
            if (raw instanceof CompoundTag serialisedEntity) {
                CompoundTag contraptionTag = serialisedEntity.getCompound("Contraption");
                String direction = contraptionTag.getString("AssemblyDirection");
                if (!direction.isBlank()) {
                    assemblyDirection = direction;
                }
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Reuse the neutral orientation if the entity is not serialized yet.
        }
    }
}
