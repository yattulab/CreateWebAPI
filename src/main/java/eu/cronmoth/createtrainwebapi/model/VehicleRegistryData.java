package eu.cronmoth.createtrainwebapi.model;

import java.util.ArrayList;
import java.util.List;

public class VehicleRegistryData {
    public List<VehicleData> vehicles = new ArrayList<>();
    public List<VehicleModelData> models = new ArrayList<>();

    public VehicleRegistryData() {
    }

    public VehicleRegistryData(List<VehicleData> vehicles, List<VehicleModelData> models) {
        this.vehicles = vehicles;
        this.models = models;
    }
}
