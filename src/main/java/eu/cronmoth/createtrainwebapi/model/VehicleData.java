package eu.cronmoth.createtrainwebapi.model;

import java.util.UUID;

public class VehicleData {
    public UUID id;
    public String dimension;
    public String name;
    public String modelId;

    public double x;
    public double y;
    public double z;

    public double quaternionX;
    public double quaternionY;
    public double quaternionZ;
    public double quaternionW;

    public double scaleX = 1.0;
    public double scaleY = 1.0;
    public double scaleZ = 1.0;

    public boolean loaded;
    public long lastSeen;

    public VehicleData() {
    }

    public VehicleData(VehicleData other) {
        this.id = other.id;
        this.dimension = other.dimension;
        this.name = other.name;
        this.modelId = other.modelId;
        this.x = other.x;
        this.y = other.y;
        this.z = other.z;
        this.quaternionX = other.quaternionX;
        this.quaternionY = other.quaternionY;
        this.quaternionZ = other.quaternionZ;
        this.quaternionW = other.quaternionW;
        this.scaleX = other.scaleX;
        this.scaleY = other.scaleY;
        this.scaleZ = other.scaleZ;
        this.loaded = other.loaded;
        this.lastSeen = other.lastSeen;
    }
}
