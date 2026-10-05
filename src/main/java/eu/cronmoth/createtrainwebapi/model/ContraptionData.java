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

        this.stalled = entity.isStalled();
    }
}
