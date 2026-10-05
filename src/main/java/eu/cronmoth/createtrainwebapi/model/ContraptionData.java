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

    /**
     * Exact local-to-world rotation basis produced by Create.
     * BlueMap can reconstruct the quaternion from these vectors without
     * duplicating Create's entity-specific rotation order.
     */
    public PointData basisX;
    public PointData basisY;
    public PointData basisZ;

    public boolean stalled;

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
    }
}
