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

    public ContraptionBlockData(StructureBlockInfo info) {
        BlockPos pos = info.pos();
        BlockState state = info.state();

        this.x = pos.getX();
        this.y = pos.getY();
        this.z = pos.getZ();
        this.block = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
        this.properties = new TreeMap<>();

        state.getValues().forEach((property, value) ->
                this.properties.put(property.getName(), String.valueOf(value)));
    }

    public String hashKey() {
        return x + "," + y + "," + z + "|" + block + "|" + properties;
    }
}
