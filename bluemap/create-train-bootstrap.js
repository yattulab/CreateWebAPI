/*
 * Deterministic loader for the CreateTrainWebAPI BlueMap integration.
 *
 * BlueMap 5.7 stores custom script URLs in a HashSet, so the order written in
 * webapp.conf is not guaranteed to be preserved. Load only this bootstrap file
 * from BlueMap and let it load the remaining scripts sequentially.
 */

(() => {
    if (window.__createTrainBootstrapStarted) return;
    window.__createTrainBootstrapStarted = true;

    const currentScriptUrl = document.currentScript?.src ?? window.location.href;
    const baseUrl = new URL(".", currentScriptUrl);

    function loadScript(fileName, { optional = false } = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(fileName, baseUrl).href;

            const existing = Array.from(document.scripts).find(script => script.src === url);
            if (existing) {
                // If another loader already inserted the same file, do not execute it twice.
                // The integration scripts themselves are idempotent where applicable.
                resolve();
                return;
            }

            const script = document.createElement("script");
            script.src = url;
            script.async = false;

            script.addEventListener("load", () => {
                console.log(`[CreateTrainBootstrap] loaded ${fileName}`);
                resolve();
            }, { once: true });

            script.addEventListener("error", () => {
                if (optional) {
                    console.warn(`[CreateTrainBootstrap] optional script unavailable: ${fileName}`);
                    resolve();
                    return;
                }

                reject(new Error(`Failed to load ${fileName}`));
            }, { once: true });

            document.body.appendChild(script);
        });
    }

    function installCoreMarkerGuard() {
        if (window.__createTrainCoreMarkerGuardInstalled) return;
        window.__createTrainCoreMarkerGuardInstalled = true;

        const ensure = () => {
            const root = window.bluemap?.mapViewer?.markers;
            if (!root) return;

            try {
                // train.js exposes these as global lexical bindings. Reattach the exact
                // same MarkerSet objects if BlueMap 5.7 removes them while refreshing
                // markers.json. Keeping the same objects also preserves their visible state.
                if (typeof routeToggle !== "undefined") {
                    const existingRoute = root.markerSets?.get("create-rail-network");
                    if (existingRoute !== routeToggle) {
                        if (existingRoute) root.remove(existingRoute);
                        root.add(routeToggle);
                        console.log("[CreateTrainBootstrap] restored Create 路線図 MarkerSet");
                    }
                }

                if (typeof trainToggle !== "undefined") {
                    const existingTrain = root.markerSets?.get("create-trains");
                    if (existingTrain !== trainToggle) {
                        if (existingTrain) root.remove(existingTrain);
                        root.add(trainToggle);
                        console.log("[CreateTrainBootstrap] restored Create 列車 MarkerSet");
                    }
                }

                const contraptionOverlay = window.CreateContraptionOverlay;
                if (contraptionOverlay?.toggle) {
                    const existingContraptions = root.markerSets?.get("create-contraptions");
                    if (existingContraptions !== contraptionOverlay.toggle) {
                        if (existingContraptions) root.remove(existingContraptions);
                        root.add(contraptionOverlay.toggle);
                        console.log("[CreateTrainBootstrap] restored Create カラクリ MarkerSet");
                    }
                }

                const vehicleOverlay = window.CreateVehicleOverlay;
                if (vehicleOverlay?.toggle) {
                    const existingVehicles = root.markerSets?.get("create-vehicles");
                    if (existingVehicles !== vehicleOverlay.toggle) {
                        if (existingVehicles) root.remove(existingVehicles);
                        root.add(vehicleOverlay.toggle);
                        console.log("[CreateTrainBootstrap] restored Create 乗り物 MarkerSet");
                    }
                }

                // Register runtime sets so subsequent marker refreshes preserve them.
                root.__createTrainRuntimeMarkerSets?.add?.("create-rail-network");
                root.__createTrainRuntimeMarkerSets?.add?.("create-trains");
                root.__createTrainRuntimeMarkerSets?.add?.("create-contraptions");
                root.__createTrainRuntimeMarkerSets?.add?.("create-vehicles");
            } catch (error) {
                console.debug("[CreateTrainBootstrap] core MarkerSet guard retry", error);
            }
        };

        ensure();
        setInterval(ensure, 500);
    }

    function installTrainLabelDistanceLimit() {
        const HtmlMarker = window.BlueMap?.HtmlMarker;
        if (!HtmlMarker || HtmlMarker.prototype.__createTrainDistanceLimitPatched) return;

        const configured = Number(window.CREATE_TRAIN_LABEL_MAX_DISTANCE ?? 4096);
        const maxDistance = Number.isFinite(configured) && configured > 0
            ? configured
            : 4096;

        const originalUpdateFromData = HtmlMarker.prototype.updateFromData;
        HtmlMarker.prototype.updateFromData = function (markerData) {
            if (markerData?.classes?.includes?.("create-train-name-marker")) {
                markerData = {
                    ...markerData,
                    maxDistance,
                };
            }

            return originalUpdateFromData.call(this, markerData);
        };

        Object.defineProperty(HtmlMarker.prototype, "__createTrainDistanceLimitPatched", {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });

        console.log(`[CreateTrainBootstrap] train-name max distance: ${maxDistance}`);
    }

    async function start() {
        try {
            // Environment-specific settings must execute before any integration code.
            await loadScript("create-train-config.js", { optional: true });

            // Core renderer first, then optional UI/features that depend on its globals.
            await loadScript("train.js");
            await loadScript("contraptions.js");
            await loadScript("vehicles.js");
            installCoreMarkerGuard();
            await loadScript("train-settings.js", { optional: true });

            // Train-name HtmlMarkers fade out with BlueMap's normal distance logic.
            // The default is fully hidden at 4096 blocks and can be overridden by
            // window.CREATE_TRAIN_LABEL_MAX_DISTANCE in create-train-config.js.
            installTrainLabelDistanceLimit();
            await loadScript("train-labels.js", { optional: true });

            console.log("[CreateTrainBootstrap] all Create overlay scripts loaded");
        } catch (error) {
            console.error("[CreateTrainBootstrap] startup failed", error);
        }
    }

    start();
})();
