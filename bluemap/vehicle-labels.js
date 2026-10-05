/*
 * Optional live Sable vehicle-name markers for BlueMap 5.7.
 *
 * Adds a top-level MarkerSet named "Create 乗り物名". Each named Sable
 * SubLevel gets an HtmlMarker that follows the vehicle's logical pose.
 * Names come from SubLevel#getName(), including names set by Aeronautics
 * Nameplates or /sable name set.
 */

(() => {
    if (window.__createVehicleLabelsInstalled) return;
    window.__createVehicleLabelsInstalled = true;

    const host = (window.CREATE_TRAIN_WEB_API_URL ?? "http://localhost:8080")
        .replace(/\/+$/, "");

    const MARKER_SET_ID = "create-vehicle-labels";
    const LABEL_OFFSET_Y = 4.0;
    const UPDATE_DURATION_MS = 200;

    const mapViewer = window.bluemap?.mapViewer;
    const BlueMap = window.BlueMap;

    if (!mapViewer || !BlueMap?.MarkerSet || !BlueMap?.HtmlMarker) {
        console.error("[CreateVehicleLabels] BlueMap MarkerSet/HtmlMarker API is unavailable");
        return;
    }

    const rootMarkerSet = mapViewer.markers;

    // Keep runtime MarkerSets alive when BlueMap refreshes markers.json.
    if (!rootMarkerSet.__createTrainRuntimeMarkerSets) {
        const originalUpdateMarkerSetsFromData =
            rootMarkerSet.updateMarkerSetsFromData.bind(rootMarkerSet);

        Object.defineProperty(rootMarkerSet, "__createTrainRuntimeMarkerSets", {
            configurable: false,
            enumerable: false,
            writable: false,
            value: new Set(),
        });

        rootMarkerSet.updateMarkerSetsFromData = function (data = {}, ignore = []) {
            const preserved = new Set(ignore ?? []);
            this.__createTrainRuntimeMarkerSets.forEach(id => preserved.add(id));
            return originalUpdateMarkerSetsFromData(data, [...preserved]);
        };
    }
    rootMarkerSet.__createTrainRuntimeMarkerSets.add(MARKER_SET_ID);

    function ensureLabelMarkerSet() {
        let markerSet = rootMarkerSet.markerSets.get(MARKER_SET_ID);
        if (markerSet) {
            markerSet.data.label = "Create 乗り物名";
            markerSet.data.toggleable = true;
            markerSet.data.sorting = 104;
            return markerSet;
        }

        markerSet = new BlueMap.MarkerSet(MARKER_SET_ID, {
            label: "Create 乗り物名",
            toggleable: true,
            defaultHidden: false,
            sorting: 104,
            markerSets: {},
            markers: {},
        });
        rootMarkerSet.add(markerSet);
        return markerSet;
    }

    let labelMarkerSet = ensureLabelMarkerSet();

    function installStyles() {
        if (document.getElementById("create-vehicle-label-styles")) return;

        const style = document.createElement("style");
        style.id = "create-vehicle-label-styles";
        style.textContent = `
#map-container .bm-marker-html.create-vehicle-name-marker {
    position: relative;
    pointer-events: none;
    user-select: none;
}

#map-container .bm-marker-html.create-vehicle-name-marker .create-vehicle-name-label {
    position: absolute;
    top: 0;
    left: 0;
    transform: translate(-50%, -100%) translate(0, -0.5em);
    white-space: nowrap;
    max-width: 20em;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0.25em 0.45em;
    border-radius: 0.2em;
    background-color: #000a;
    color: #fff;
    filter: drop-shadow(1px 1px 3px #0008);
    font-size: 0.9em;
    line-height: 1.2em;
}

#map-container .bm-marker-html.create-vehicle-name-marker .create-vehicle-name-label::after {
    position: absolute;
    left: 50%;
    bottom: -0.4em;
    transform: translateX(-50%);
    content: "";
    border: solid 0.2em transparent;
    border-top-color: #000a;
}
`;
        document.head.appendChild(style);
    }
    installStyles();

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function vehicleName(vehicle) {
        if (vehicle?.name == null) return null;
        const name = String(vehicle.name).trim();
        return name.length > 0 ? name : null;
    }

    function currentMapIdentities() {
        const map = mapViewer.map;
        const data = map?.data ?? {};
        const values = [
            data.name,
            data.world,
            data.dimension,
            data.id,
            data.key,
            map?.id,
            map?.key,
        ]
            .filter(value => typeof value === "string" && value.length > 0)
            .map(value => value.toLocaleLowerCase());

        for (const value of [...values]) {
            const match = /\((?<name>.*)\)/.exec(value);
            if (match?.groups?.name) values.push(match.groups.name.toLocaleLowerCase());
        }

        return [...new Set(values)];
    }

    function configuredDimensionForCurrentMap() {
        const overrides = window.CREATE_MAP_DIMENSION_OVERRIDES;
        if (!overrides || typeof overrides !== "object") return null;

        for (const identity of currentMapIdentities()) {
            const configured = overrides[identity];
            if (typeof configured === "string" && configured.length > 0) {
                return configured.toLocaleLowerCase();
            }
        }

        return null;
    }

    function inferredDimensionForCurrentMap() {
        const configured = configuredDimensionForCurrentMap();
        if (configured) return configured;

        const identities = currentMapIdentities();

        if (identities.some(identity => identity.includes("nether"))) {
            return "minecraft:the_nether";
        }

        if (identities.some(identity =>
            identity === "end" ||
            identity.includes("the_end") ||
            identity.includes("the end")
        )) {
            return "minecraft:the_end";
        }

        return "minecraft:overworld";
    }

    function dimensionMatchesCurrentMap(dimension) {
        const dim = String(dimension ?? "").toLocaleLowerCase();
        if (!dim) return false;

        const identities = currentMapIdentities();
        if (identities.some(identity =>
            dim.includes(identity) || identity.includes(dim)
        )) {
            return true;
        }

        return dim === inferredDimensionForCurrentMap();
    }

    function markerIdForVehicle(vehicleId) {
        return `create-vehicle-label-${encodeURIComponent(String(vehicleId))}`;
    }

    function interpolatePosition(state, now) {
        if (!state) return null;

        const duration = Math.max(1, state.endTime - state.startTime);
        const t = Math.max(0, Math.min(1, (now - state.startTime) / duration));

        return {
            x: state.start.x + (state.end.x - state.start.x) * t,
            y: state.start.y + (state.end.y - state.start.y) * t,
            z: state.start.z + (state.end.z - state.start.z) * t,
        };
    }

    function ensureVehicleMarker(vehicle, markerId, position, sorting) {
        labelMarkerSet = ensureLabelMarkerSet();

        let marker = labelMarkerSet.markers.get(markerId);
        if (!marker || !marker.isHtmlMarker) {
            if (marker) labelMarkerSet.remove(marker);
            marker = new BlueMap.HtmlMarker(markerId);
            labelMarkerSet.add(marker);
        }

        const name = vehicleName(vehicle);
        if (!name) return null;

        marker.updateFromData({
            position: {
                x: position.x,
                y: position.y + LABEL_OFFSET_Y,
                z: position.z,
            },
            label: name,
            sorting,
            listed: true,
            anchor: { x: 0, y: 0 },
            html: `<div class="create-vehicle-name-label">${escapeHtml(name)}</div>`,
            classes: ["create-vehicle-name-marker"],
            minDistance: 0,
            maxDistance: Number.MAX_VALUE,
        });
        marker.visible = true;

        return marker;
    }

    let vehiclesData = [];
    const animationStates = new Map();

    function updateVehicleTargets() {
        labelMarkerSet = ensureLabelMarkerSet();

        const now = performance.now();
        const wantedMarkers = new Set();
        const wantedVehicles = new Set();

        vehiclesData.forEach((vehicle, sorting) => {
            const name = vehicleName(vehicle);
            if (!name) return;
            if (!dimensionMatchesCurrentMap(vehicle.dimension)) return;

            const vehicleId = String(vehicle.id);
            const markerId = markerIdForVehicle(vehicleId);
            const end = {
                x: Number(vehicle.x ?? 0),
                y: Number(vehicle.y ?? 0),
                z: Number(vehicle.z ?? 0),
            };

            const previous = animationStates.get(vehicleId);
            const start = interpolatePosition(previous, now) ?? end;

            animationStates.set(vehicleId, {
                markerId,
                start,
                end,
                startTime: now,
                endTime: previous && vehicle.loaded
                    ? now + UPDATE_DURATION_MS
                    : now,
            });

            ensureVehicleMarker(vehicle, markerId, start, sorting);
            wantedMarkers.add(markerId);
            wantedVehicles.add(vehicleId);
        });

        [...labelMarkerSet.markers.entries()].forEach(([markerId, marker]) => {
            if (wantedMarkers.has(markerId)) return;
            labelMarkerSet.remove(marker);
        });

        [...animationStates.keys()].forEach(vehicleId => {
            if (!wantedVehicles.has(vehicleId)) animationStates.delete(vehicleId);
        });
    }

    function connectVehicleStream() {
        const source = new EventSource(`${host}/vehiclesLive`);

        source.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                vehiclesData = Array.isArray(data) ? data : [];
                updateVehicleTargets();
            } catch (error) {
                console.error("[CreateVehicleLabels] invalid vehicle update", error);
            }
        };

        source.onerror = event => {
            console.error("[CreateVehicleLabels] SSE error", event);
        };

        return source;
    }

    function animationLoop() {
        if (labelMarkerSet?.visible) {
            const now = performance.now();

            animationStates.forEach(state => {
                const marker = labelMarkerSet.markers.get(state.markerId);
                if (!marker) return;

                const position = interpolatePosition(state, now);
                if (!position) return;

                marker.position.set(
                    position.x,
                    position.y + LABEL_OFFSET_Y,
                    position.z
                );
            });

            mapViewer.redraw?.();
        }

        requestAnimationFrame(animationLoop);
    }

    let lastWorldSignature = currentMapIdentities().join("|");

    window.bluemap?.events?.addEventListener?.("bluemapMapChanged", () => {
        lastWorldSignature = currentMapIdentities().join("|");
        updateVehicleTargets();
    });

    setInterval(() => {
        const signature = currentMapIdentities().join("|");
        if (signature === lastWorldSignature) return;

        lastWorldSignature = signature;
        updateVehicleTargets();
    }, 500);

    connectVehicleStream();
    animationLoop();

    console.log("[CreateVehicleLabels] live vehicle-name markers started");
})();
