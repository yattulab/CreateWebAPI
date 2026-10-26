package eu.cronmoth.createtrainwebapi.model;

import java.util.ArrayList;
import java.util.List;

public class ContraptionRegistryData {
    public List<ContraptionData> contraptions = new ArrayList<>();
    public List<ContraptionModelData> models = new ArrayList<>();

    public ContraptionRegistryData() {
    }

    public ContraptionRegistryData(List<ContraptionData> contraptions, List<ContraptionModelData> models) {
        this.contraptions = contraptions;
        this.models = models;
    }
}
