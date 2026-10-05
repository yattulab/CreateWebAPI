package eu.cronmoth.createtrainwebapi.model;

import java.util.ArrayList;
import java.util.List;

public class VehicleModelData {
    public String id;
    public int blockCount;
    public List<ContraptionBlockData> blocks;

    public VehicleModelData() {
        this.blocks = new ArrayList<>();
    }

    public VehicleModelData(String id, List<ContraptionBlockData> blocks) {
        this.id = id;
        this.blocks = List.copyOf(blocks);
        this.blockCount = blocks.size();
    }
}
