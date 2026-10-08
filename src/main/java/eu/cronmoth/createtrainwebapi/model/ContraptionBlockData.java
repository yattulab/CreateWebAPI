package eu.cronmoth.createtrainwebapi.model;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate.StructureBlockInfo;

import java.util.Map;
import java.util.TreeMap;

public class ContraptionBlockData {
    public int x;
    public int y;
    public int z;
    public String block;
    public Map<String, String> properties;

    public ContraptionBlockData() {
        this.properties = new TreeMap<>();
    }

    public ContraptionBlockData(StructureBlockInfo info) {
        this(info.pos().getX(), info.pos().getY(), info.pos().getZ(), info.state());
    }

    public ContraptionBlockData(int x, int y, int z, BlockState state) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.block = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        this.properties = new TreeMap<>();

        state.getValues().forEach((property, value) ->
                this.properties.put(property.getName(), String.valueOf(value)));
    }

    public String hashKey() {
        return x + "," + y + "," + z + "|" + block + "|" + properties;
    }
}
