package eu.cronmoth.createtrainwebapi.model;

import java.util.ArrayList;
import java.util.List;

public class ContraptionModelData {
    public String id;
    public int blockCount;
    public List<ContraptionBlockData> blocks;

    public ContraptionModelData() {
        this.blocks = new ArrayList<>();
    }

    public ContraptionModelData(String id, List<ContraptionBlockData> blocks) {
        this.id = id;
        this.blocks = List.copyOf(blocks);
        this.blockCount = blocks.size();
    }
}
