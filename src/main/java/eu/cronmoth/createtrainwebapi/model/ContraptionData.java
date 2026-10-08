package eu.cronmoth.createtrainwebapi.model;

import com.simibubi.create.content.contraptions.AbstractContraptionEntity;
import com.simibubi.create.content.contraptions.AbstractContraptionEntity.ContraptionRotationState;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.phys.Vec3;

import java.util.UUID;

public class ContraptionData {
    public UUID id;
    public String dimension;
    public String entityType;
    public String modelId;

    public double x;
    public double y;
    public double z;

    public float rotationX;
    public float rotationY;
    public float rotationZ;
    public float secondYRotation;

    public PointData basisX;
    public PointData basisY;
    public PointData basisZ;

    public boolean stalled;

    /**
     * true while the backing Contraption Entity is loaded in a server level.
     * false means this is the last known state retained for BlueMap.
     */
    public boolean loaded;

    /**
     * Unix epoch milliseconds when the live entity was last observed.
     */
    public long lastSeen;

    public ContraptionData() {
    }

    public ContraptionData(AbstractContraptionEntity entity, String modelId) {
        Vec3 anchor = entity.getAnchorVec();
        ContraptionRotationState rotation = entity.getRotationState();

        this.id = entity.getUUID();
        this.dimension = entity.level().dimension().location().toString();
        this.entityType = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
        this.modelId = modelId;

        this.x = anchor.x;
        this.y = anchor.y;
        this.z = anchor.z;

        this.rotationX = rotation.xRotation;
        this.rotationY = rotation.yRotation;
        this.rotationZ = rotation.zRotation;
        this.secondYRotation = rotation.secondYRotation;

        this.basisX = new PointData(entity.applyRotation(new Vec3(1, 0, 0), 1.0f));
        this.basisY = new PointData(entity.applyRotation(new Vec3(0, 1, 0), 1.0f));
        this.basisZ = new PointData(entity.applyRotation(new Vec3(0, 0, 1), 1.0f));

        this.stalled = entity.isStalled();
        this.loaded = true;
        this.lastSeen = System.currentTimeMillis();
    }

    public ContraptionData(ContraptionData other) {
        this.id = other.id;
        this.dimension = other.dimension;
        this.entityType = other.entityType;
        this.modelId = other.modelId;
        this.x = other.x;
        this.y = other.y;
        this.z = other.z;
        this.rotationX = other.rotationX;
        this.rotationY = other.rotationY;
        this.rotationZ = other.rotationZ;
        this.secondYRotation = other.secondYRotation;
        this.basisX = other.basisX == null ? null : new PointData(other.basisX);
        this.basisY = other.basisY == null ? null : new PointData(other.basisY);
        this.basisZ = other.basisZ == null ? null : new PointData(other.basisZ);
        this.stalled = other.stalled;
        this.loaded = other.loaded;
        this.lastSeen = other.lastSeen;
    }
}
