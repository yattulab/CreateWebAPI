package eu.cronmoth.createtrainwebapi.model;

import net.minecraft.world.phys.Vec3;

public class PointData {
    public double x, y, z;

    public PointData() {
    }

    public PointData(double x, double y, double z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public PointData(Vec3 vec3) {
        x = vec3.x;
        y = vec3.y;
        z = vec3.z;
    }

    public PointData(PointData other) {
        this(other.x, other.y, other.z);
    }
}
