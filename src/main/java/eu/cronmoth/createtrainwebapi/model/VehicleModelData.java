package eu.cronmoth.createtrainwebapi.model;

import java.util.ArrayList;
import java.util.List;

public class VehicleModelData {
    public String id;
    public int blockCount;
    public double originOffsetX;
    public double originOffsetY;
    public double originOffsetZ;
    public List<ContraptionBlockData> blocks;

    public VehicleModelData() {
        this.blocks = new ArrayList<>();
    }

    public VehicleModelData(
            String id,
            double originOffsetX,
            double originOffsetY,
            double originOffsetZ,
            List<ContraptionBlockData> blocks
    ) {
        this.id = id;
        this.originOffsetX = originOffsetX;
        this.originOffsetY = originOffsetY;
        this.originOffsetZ = originOffsetZ;
        this.blocks = List.copyOf(blocks);
        this.blockCount = blocks.size();
    }
}
