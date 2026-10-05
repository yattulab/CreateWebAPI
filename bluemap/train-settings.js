/*
 * Optional drawing-settings UI for bluemap/train.js.
 *
 * Visibility is still controlled by the BlueMap MarkerSets:
 *   - Create 路線図
 *   - Create 列車
 *
 * This file only controls whether those overlays are rendered through terrain.
 */

(() => {
    if (window.__createTrainDrawingSettingsInstalled) return;
    window.__createTrainDrawingSettingsInstalled = true;

    const STORAGE_KEYS = {
        linesThroughTerrain: "create-train-lines-through-terrain",
        trainsThroughTerrain: "create-train-trains-through-terrain",
        contraptionsThroughTerrain: "create-contraptions-through-terrain",
    };

    function loadBoolean(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            if (value === null) return fallback;
            return value === "true";
        } catch (_) {
            return fallback;
        }
    }

    function saveBoolean(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (_) { }
    }

    const state = {
        linesThroughTerrain: loadBoolean(
            STORAGE_KEYS.linesThroughTerrain,
            window.CREATE_TRAIN_LINES_THROUGH_TERRAIN ?? true
        ),
        trainsThroughTerrain: loadBoolean(
            STORAGE_KEYS.trainsThroughTerrain,
            window.CREATE_TRAIN_TRAINS_THROUGH_TERRAIN ?? false
        ),
        contraptionsThroughTerrain: loadBoolean(
            STORAGE_KEYS.contraptionsThroughTerrain,
            window.CREATE_CONTRAPTIONS_THROUGH_TERRAIN ?? false
        ),
    };

    const BUTTON_ID = "create-train-settings-button";
    const PANEL_ID = "create-train-settings-panel";

    function syncInputs() {
        const linesInput = document.getElementById("create-train-lines-through-terrain");
        const trainsInput = document.getElementById("create-train-trains-through-terrain");
        const contraptionsInput = document.getElementById("create-contraptions-through-terrain");
        if (linesInput) linesInput.checked = state.linesThroughTerrain;
        if (trainsInput) trainsInput.checked = state.trainsThroughTerrain;
        if (contraptionsInput) contraptionsInput.checked = state.contraptionsThroughTerrain;
    }

    function setLinesThroughTerrain(value) {
        state.linesThroughTerrain = !!value;
        saveBoolean(STORAGE_KEYS.linesThroughTerrain, state.linesThroughTerrain);
        syncInputs();
    }

    function setTrainsThroughTerrain(value) {
        state.trainsThroughTerrain = !!value;
        saveBoolean(STORAGE_KEYS.trainsThroughTerrain, state.trainsThroughTerrain);
        syncInputs();
    }

    function setContraptionsThroughTerrain(value) {
        state.contraptionsThroughTerrain = !!value;
        saveBoolean(STORAGE_KEYS.contraptionsThroughTerrain, state.contraptionsThroughTerrain);
        syncInputs();
    }

    window.createTrainDrawingSettings = {
        get linesThroughTerrain() {
            return state.linesThroughTerrain;
        },
        set linesThroughTerrain(value) {
            setLinesThroughTerrain(value);
        },
        get trainsThroughTerrain() {
            return state.trainsThroughTerrain;
        },
        set trainsThroughTerrain(value) {
            setTrainsThroughTerrain(value);
        },
        get contraptionsThroughTerrain() {
            return state.contraptionsThroughTerrain;
        },
        set contraptionsThroughTerrain(value) {
            setContraptionsThroughTerrain(value);
        },
    };

    function ensureStyle() {
        if (document.getElementById(`${PANEL_ID}-style`)) return;

        const style = document.createElement("style");
        style.id = `${PANEL_ID}-style`;
        style.textContent = `
            #${PANEL_ID} {
                position: fixed;
                top: 4.5rem;
                left: 1rem;
                z-index: 10000;
                width: min(22rem, calc(100vw - 2rem));
                padding: 0.85rem;
                box-sizing: border-box;
                background: var(--theme-bg, #222);
                color: var(--theme-fg, #fff);
                border: 1px solid var(--theme-bg-hover, #555);
                border-radius: 0.5rem;
                filter: drop-shadow(1px 1px 4px #0008);
                font: inherit;
            }

            #${PANEL_ID}[hidden] {
                display: none;
            }

            #${PANEL_ID} .create-train-settings-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.75rem;
                margin-bottom: 0.65rem;
                font-weight: 600;
            }

            #${PANEL_ID} .create-train-settings-close {
                appearance: none;
                border: 0;
                background: transparent;
                color: inherit;
                cursor: pointer;
                font: inherit;
                font-size: 1.25rem;
                line-height: 1;
                padding: 0.2rem 0.35rem;
            }

            #${PANEL_ID} .create-train-settings-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 1rem;
                padding: 0.6rem 0;
                cursor: pointer;
                user-select: none;
            }

            #${PANEL_ID} .create-train-settings-row + .create-train-settings-row {
                border-top: 1px solid var(--theme-bg-hover, #555);
            }

            #${PANEL_ID} .create-train-switch {
                position: relative;
                flex: 0 0 auto;
                width: 2.6rem;
                height: 1.4rem;
            }

            #${PANEL_ID} .create-train-switch input {
                position: absolute;
                opacity: 0;
                pointer-events: none;
            }

            #${PANEL_ID} .create-train-switch-track {
                position: absolute;
                inset: 0;
                border-radius: 999px;
                background: var(--theme-bg-hover, #555);
                transition: background 120ms ease;
            }

            #${PANEL_ID} .create-train-switch-track::after {
                content: "";
                position: absolute;
                width: 1rem;
                height: 1rem;
                top: 0.2rem;
                left: 0.2rem;
                border-radius: 50%;
                background: var(--theme-fg, #fff);
                transition: transform 120ms ease;
            }

            #${PANEL_ID} .create-train-switch input:checked + .create-train-switch-track {
                background: #3f8cff;
            }

            #${PANEL_ID} .create-train-switch input:checked + .create-train-switch-track::after {
                transform: translateX(1.2rem);
            }

            #${PANEL_ID} .create-train-settings-note {
                margin-top: 0.65rem;
                font-size: 0.8em;
                opacity: 0.75;
            }
        `;
        document.head.appendChild(style);
    }

    function createPanel() {
        let panel = document.getElementById(PANEL_ID);
        if (panel) return panel;

        ensureStyle();

        panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.hidden = true;
        panel.innerHTML = `
            <div class="create-train-settings-header">
                <span>Create 描画設定</span>
                <button type="button" class="create-train-settings-close" aria-label="Close">×</button>
            </div>
            <label class="create-train-settings-row">
                <span>路線図を地形越しに表示</span>
                <span class="create-train-switch">
                    <input id="create-train-lines-through-terrain" type="checkbox">
                    <span class="create-train-switch-track"></span>
                </span>
            </label>
            <label class="create-train-settings-row">
                <span>列車を地形越しに表示</span>
                <span class="create-train-switch">
                    <input id="create-train-trains-through-terrain" type="checkbox">
                    <span class="create-train-switch-track"></span>
                </span>
            </label>
            <label class="create-train-settings-row">
                <span>カラクリを地形越しに表示</span>
                <span class="create-train-switch">
                    <input id="create-contraptions-through-terrain" type="checkbox">
                    <span class="create-train-switch-track"></span>
                </span>
            </label>
            <div class="create-train-settings-note">
                表示・非表示はBlueMapの「マーカー」から切り替えます．
            </div>
        `;

        panel.querySelector(".create-train-settings-close")?.addEventListener("click", () => {
            panel.hidden = true;
        });

        panel.querySelector("#create-train-lines-through-terrain")?.addEventListener("change", event => {
            setLinesThroughTerrain(event.target.checked);
        });

        panel.querySelector("#create-train-trains-through-terrain")?.addEventListener("change", event => {
            setTrainsThroughTerrain(event.target.checked);
        });

        panel.querySelector("#create-contraptions-through-terrain")?.addEventListener("change", event => {
            setContraptionsThroughTerrain(event.target.checked);
        });

        document.body.appendChild(panel);
        syncInputs();
        return panel;
    }

    function togglePanel() {
        const panel = createPanel();
        panel.hidden = !panel.hidden;
        if (!panel.hidden) syncInputs();
    }

    function ensureMenuButton() {
        const page = window.bluemap?.mainMenu?.currentPage?.();
        if (page?.id !== "root") return;
        if (document.getElementById(BUTTON_ID)) return;

        const rootMenu = document.querySelector(".side-menu > .content > div");
        if (!rootMenu) return;

        const button = document.createElement("div");
        button.id = BUTTON_ID;
        button.className = "simple-button";
        button.style.cursor = "pointer";
        button.innerHTML = '<div class="label">Create 描画設定</div>';
        button.addEventListener("click", togglePanel);

        const separator = rootMenu.querySelector("hr");
        rootMenu.insertBefore(button, separator ?? null);
    }

    function installRenderLoopOverride() {
        if (window.__createTrainDrawingSettingsRenderLoopInstalled) return true;

        if (
            typeof renderOverlayLoop !== "function" ||
            typeof animateTrains !== "function" ||
            typeof mapViewer === "undefined" ||
            typeof renderer === "undefined" ||
            typeof linesScene === "undefined" ||
            typeof trainsScene === "undefined" ||
            typeof routeToggle === "undefined" ||
            typeof trainToggle === "undefined"
        ) {
            return false;
        }

        renderOverlayLoop = function createTrainRenderOverlayLoopWithSettings() {
            animateTrains();

            const contraptions = window.CreateContraptionOverlay;
            contraptions?.animate?.();

            const camera = mapViewer.camera;
            const showLines = routeToggle.visible;
            const showTrains = trainToggle.visible;
            const showContraptions = contraptions?.toggle?.visible ?? false;

            // Draw depth-tested overlays first so terrain can occlude them.
            if (showLines && !state.linesThroughTerrain) {
                renderer.render(linesScene, camera);
            }
            if (showTrains && !state.trainsThroughTerrain) {
                renderer.render(trainsScene, camera);
            }
            if (showContraptions && !state.contraptionsThroughTerrain) {
                renderer.render(contraptions.scene, camera);
            }

            // Draw through-terrain overlays only after clearing the depth buffer.
            if (
                (showLines && state.linesThroughTerrain) ||
                (showTrains && state.trainsThroughTerrain) ||
                (showContraptions && state.contraptionsThroughTerrain)
            ) {
                renderer.clearDepth();
                if (showLines && state.linesThroughTerrain) {
                    renderer.render(linesScene, camera);
                }
                if (showTrains && state.trainsThroughTerrain) {
                    renderer.render(trainsScene, camera);
                }
                if (showContraptions && state.contraptionsThroughTerrain) {
                    renderer.render(contraptions.scene, camera);
                }
            }

            requestAnimationFrame(renderOverlayLoop);
        };

        window.__createTrainDrawingSettingsRenderLoopInstalled = true;
        console.log("[CreateTrain] drawing settings GUI installed");
        return true;
    }

    const installTimer = setInterval(() => {
        ensureMenuButton();
        if (installRenderLoopOverride()) clearInterval(installTimer);
    }, 250);

    // The menu DOM is recreated as BlueMap pages open and close, so keep the
    // lightweight button check running independently of the render-loop install.
    setInterval(ensureMenuButton, 500);

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.hidden = true;
    });
})();
