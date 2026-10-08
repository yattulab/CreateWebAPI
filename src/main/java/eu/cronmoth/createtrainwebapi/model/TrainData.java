package eu.cronmoth.createtrainwebapi.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.simibubi.create.content.trains.entity.Carriage;
import com.simibubi.create.content.trains.entity.Train;
import com.simibubi.create.content.trains.graph.TrackGraph;

import javax.annotation.Nullable;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** A transport-only snapshot; never expose live Create objects to HTTP threads. */
public class TrainData {
    public UUID id;
    @Nullable
    public UUID owner;
    @JsonIgnore
    public TrackGraph graph;
    public UUID currentStation;
    public UUID targetStation;
    public String name;
    public List<TrainCarData> cars;
    public boolean backwards;
    public boolean stopped;

    public TrainData(Train train) {
        if (train == null || train.id == null) {
            throw new IllegalArgumentException("Cannot snapshot a train without an ID");
        }

        id = train.id;
        owner = train.owner;
        currentStation = train.currentStation;
        name = train.name == null ? "" : train.name.toString();

        if (train.navigation != null && train.navigation.destination != null) {
            targetStation = train.navigation.destination.id;
        }

        backwards = train.currentlyBackwards;
        stopped = train.speed == 0;

        cars = new ArrayList<>();
        if (train.carriages != null) {
            for (Carriage carriage : train.carriages) {
                // Each carriage defends against null TravellingPoints and missing
                // serialized entity data. Keep list indexes aligned with the
                // train's PRBM filename suffix (<trainId>_<carIndex>.prbm).
                cars.add(new TrainCarData(carriage));
            }
        }
    }
}
