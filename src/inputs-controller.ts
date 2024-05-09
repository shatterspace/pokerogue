import Phaser, {Time} from "phaser";
import * as Utils from "./utils";
import {initTouchControls} from './touch-controls';
import pad_generic from "./configs/pad_generic";
import pad_unlicensedSNES from "./configs/pad_unlicensedSNES";
import pad_xbox360 from "./configs/pad_xbox360";
import pad_dualshock from "./configs/pad_dualshock";
import {Button} from "./enums/buttons";

export interface GamepadMapping {
    [key: string]: number;
}

export interface GamepadConfig {
    padID: string;
    padType: string;
    gamepadMapping: GamepadMapping;
}

export interface ActionGamepadMapping {
    [key: string]: Button;
}

const repeatInputDelayMillis = 250;

export class InputsController {
    private buttonKeys: Phaser.Input.Keyboard.Key[][];
    private gamepads: Array<string> = new Array();
    private scene: Phaser.Scene;

    // buttonLock ensures only a single movement key is firing repeated inputs
    // (i.e. by holding down a button) at a time
    private buttonLock: Button;
    private buttonLock2: Button;
    private interactions: Map<Button, Map<string, boolean>> = new Map();
    private time: Time;
    private player: Map<String, GamepadMapping> = new Map();

    private gamepadSupport: boolean = true;

    public customGamepadMapping = new Map();
    public chosenGamepad: String;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
        this.time = this.scene.time;
        this.buttonKeys = [];

        for (const b of Utils.getEnumValues(Button)) {
            this.interactions[b] = {
                pressTime: false,
                isPressed: false,
                source: null,
            }
        }
        // We don't want the menu key to be repeated
        delete this.interactions[Button.MENU];
        delete this.interactions[Button.STATS];
        this.init();
    }

    init(): void {
        this.events = new Phaser.Events.EventEmitter();

        if (localStorage.hasOwnProperty('chosenGamepad')) {
            this.chosenGamepad = localStorage.getItem('chosenGamepad');
        }
		// Handle the game losing focus
		this.scene.game.events.on(Phaser.Core.Events.BLUR, () => {
			this.loseFocus()
		})

        if (typeof this.scene.input.gamepad !== 'undefined') {
            this.scene.input.gamepad.on('connected', function (thisGamepad) {
                this.refreshGamepads();
                this.setupGamepad(thisGamepad);
            }, this);

            // Check to see if the gamepad has already been setup by the browser
            this.scene.input.gamepad.refreshPads();
            if (this.scene.input.gamepad.total) {
                this.refreshGamepads();
                for (const thisGamepad of this.gamepads) {
                    this.scene.input.gamepad.emit('connected', thisGamepad);
                }
            }

            this.scene.input.gamepad.on('down', this.gamepadButtonDown, this);
            this.scene.input.gamepad.on('up', this.gamepadButtonUp, this);
        }

        // Keyboard
        this.setupKeyboardControls();
    }

    loseFocus(): void {
        this.deactivatePressedKey();
    }

    setGamepadSupport(value: boolean): void {
        if (value) {
            this.gamepadSupport = true;
        } else {
            this.gamepadSupport = false;
            this.deactivatePressedKey();
        }
    }

    setChosenGamepad(gamepad: String): void {
        this.deactivatePressedKey();
        this.chosenGamepad = gamepad;
    }

    update(): void {
        // reversed to let the cancel button have a kinda priority on the action button
        for (const b of Utils.getEnumValues(Button).reverse()) {
            if (
                this.interactions.hasOwnProperty(b) &&
                this.repeatInputDurationJustPassed(b) &&
                this.interactions[b].isPressed
            ) {
                if (
                    (!this.gamepadSupport && this.interactions[b].source === 'gamepad') ||
                    (this.interactions[b].sourceName !== null && this.interactions[b].sourceName !== this.chosenGamepad)
                ) {
                    this.delLastProcessedMovementTime(b);
                    return;
                }
                this.events.emit('input_down', {
                    controller_type: this.interactions[b].source,
                    button: b,
                });
                this.setLastProcessedMovementTime(b, this.interactions[b].source, this.interactions[b].sourceName);
            }
        }
    }

    getGamepadsName(): Array<String> {
        return this.gamepads.map(g => g.id);
    }

    setupGamepad(thisGamepad: Phaser.Input.Gamepad.Gamepad): void {
        let gamepadID = this.chosenGamepad?.toLowerCase() || thisGamepad.id.toLowerCase();
        const mappedPad = this.mapGamepad(gamepadID);
        this.player['mapping'] = mappedPad.gamepadMapping;
        if (!this.chosenGamepad) {
            this.chosenGamepad = thisGamepad.id;
            localStorage.setItem('chosenGamepad', this.chosenGamepad);
        }
    }

    refreshGamepads(): void {
        // Sometimes, gamepads are undefined. For some reason.
        this.gamepads = this.scene.input.gamepad.gamepads.filter(function (el) {
            return el != null;
        });

        for (const [index, thisGamepad] of this.gamepads.entries()) {
            thisGamepad.index = index; // Overwrite the gamepad index, in case we had undefined gamepads earlier
        }
    }

    getActionGamepadMapping(): ActionGamepadMapping {
        const gamepadMapping = {};
        if (!this.player?.mapping) return gamepadMapping;
        gamepadMapping[this.player.mapping.LC_N] = Button.UP;
        gamepadMapping[this.player.mapping.LC_S] = Button.DOWN;
        gamepadMapping[this.player.mapping.LC_W] = Button.LEFT;
        gamepadMapping[this.player.mapping.LC_E] = Button.RIGHT;
        gamepadMapping[this.player.mapping.TOUCH] = Button.SUBMIT;
        gamepadMapping[this.player.mapping.RC_S] = this.scene.abSwapped ? Button.CANCEL : Button.ACTION;
        gamepadMapping[this.player.mapping.RC_E] = this.scene.abSwapped ? Button.ACTION : Button.CANCEL;
        gamepadMapping[this.player.mapping.SELECT] = Button.STATS;
        gamepadMapping[this.player.mapping.START] = Button.MENU;
        gamepadMapping[this.player.mapping.RB] = Button.RB;
        gamepadMapping[this.player.mapping.LB] = Button.LB;
        gamepadMapping[this.player.mapping.LT] = Button.CYCLE_GENDER;
        gamepadMapping[this.player.mapping.RT] = Button.CYCLE_ABILITY;
        gamepadMapping[this.player.mapping.RC_W] = Button.CYCLE_NATURE;
        gamepadMapping[this.player.mapping.RC_N] = Button.CYCLE_VARIANT;
        gamepadMapping[this.player.mapping.LS] = Button.SPEED_UP;
        gamepadMapping[this.player.mapping.RS] = Button.SLOW_DOWN;

        return gamepadMapping;
    }

    gamepadButtonDown(pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button, value: number): void {
        if (!this.gamepadSupport || pad.id.toLowerCase() !== this.chosenGamepad.toLowerCase()) return;
        const actionMapping = this.getActionGamepadMapping();
        const buttonDown = actionMapping.hasOwnProperty(button.index) && actionMapping[button.index];
        if (buttonDown !== undefined) {
            this.events.emit('input_down', {
                controller_type: 'gamepad',
                button: buttonDown,
            });
            this.setLastProcessedMovementTime(buttonDown, 'gamepad', pad.id);
        }
    }

    gamepadButtonUp(pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button, value: number): void {
        if (!this.gamepadSupport || pad.id.toLowerCase() !== this.chosenGamepad.toLowerCase()) return;
        const actionMapping = this.getActionGamepadMapping();
        const buttonUp = actionMapping.hasOwnProperty(button.index) && actionMapping[button.index];
        if (buttonUp !== undefined) {
            this.events.emit('input_up', {
                controller_type: 'gamepad',
                button: buttonUp,
            });
            this.delLastProcessedMovementTime(buttonUp);
        }
    }

    setupKeyboardControls(): void {
        const keyCodes = Phaser.Input.Keyboard.KeyCodes;
        const keyConfig = {
            [Button.UP]: [keyCodes.UP, keyCodes.W],
            [Button.DOWN]: [keyCodes.DOWN, keyCodes.S],
            [Button.LEFT]: [keyCodes.LEFT, keyCodes.A],
            [Button.RIGHT]: [keyCodes.RIGHT, keyCodes.D],
            [Button.SUBMIT]: [keyCodes.ENTER],
            [Button.ACTION]: [keyCodes.SPACE, keyCodes.Z],
            [Button.CANCEL]: [keyCodes.BACKSPACE, keyCodes.X],
            [Button.MENU]: [keyCodes.ESC, keyCodes.M],
            [Button.STATS]: [keyCodes.SHIFT, keyCodes.C],
            [Button.RB]: [keyCodes.R],
            [Button.LB]: [keyCodes.F],
            [Button.CYCLE_GENDER]: [keyCodes.G],
            [Button.CYCLE_ABILITY]: [keyCodes.E],
            [Button.CYCLE_NATURE]: [keyCodes.N],
            [Button.CYCLE_VARIANT]: [keyCodes.V],
            [Button.SPEED_UP]: [keyCodes.PLUS],
            [Button.SLOW_DOWN]: [keyCodes.MINUS]
        };
        const mobileKeyConfig = {};
        for (const b of Utils.getEnumValues(Button)) {
            const keys: Phaser.Input.Keyboard.Key[] = [];
            if (keyConfig.hasOwnProperty(b)) {
                for (let k of keyConfig[b])
                    keys.push(this.scene.input.keyboard.addKey(k, false));
                mobileKeyConfig[Button[b]] = keys[0];
            }
            this.buttonKeys[b] = keys;
        }

        initTouchControls(mobileKeyConfig);
        this.listenInputKeyboard();
    }

    listenInputKeyboard(): void {
        this.buttonKeys.forEach((row, index) => {
            for (const key of row) {
                key.on('down', () => {
                    this.events.emit('input_down', {
                        controller_type: 'keyboard',
                        button: index,
                    });
                    this.setLastProcessedMovementTime(index, 'keyboard');
                });
                key.on('up', () => {
                    this.events.emit('input_up', {
                        controller_type: 'keyboard',
                        button: index,
                    });
                    this.delLastProcessedMovementTime(index);
                });
            }
        });
    }

    mapGamepad(id: string): GamepadConfig {
        id = id.toLowerCase();

        if (id.includes('081f') && id.includes('e401')) {
            return pad_unlicensedSNES;
        } else if (id.includes('xbox') && id.includes('360')) {
            return pad_xbox360;
        } else if (id.includes('054c')) {
            return pad_dualshock;
        }

        return pad_generic;
    }

    /**
     * repeatInputDurationJustPassed returns true if @param button has been held down long
     * enough to fire a repeated input. A button must claim the buttonLock before
     * firing a repeated input - this is to prevent multiple buttons from firing repeatedly.
     */
    repeatInputDurationJustPassed(button: Button): boolean {
        if (!this.isButtonLocked(button)) return false;
        if (this.time.now - this.interactions[button].pressTime >= repeatInputDelayMillis) {
            return true;
        }
    }

    setLastProcessedMovementTime(button: Button, source: String = 'keyboard', sourceName: String): void {
        if (!this.interactions.hasOwnProperty(button)) return;
        this.setButtonLock(button);
        this.interactions[button].pressTime = this.time.now;
        this.interactions[button].isPressed = true;
        this.interactions[button].source = source;
        this.interactions[button].sourceName = sourceName;
    }

    delLastProcessedMovementTime(button: Button): void {
        if (!this.interactions.hasOwnProperty(button)) return;
        this.releaseButtonLock(button);
        this.interactions[button].pressTime = null;
        this.interactions[button].isPressed = false;
        this.interactions[button].source = null;
        this.interactions[button].sourceName = null;
    }

    deactivatePressedKey(): void {
        this.releaseButtonLock(this.buttonLock);
        this.releaseButtonLock(this.buttonLock2);
        for (const b of Utils.getEnumValues(Button)) {
            if (this.interactions.hasOwnProperty(b)) {
                this.interactions[b].pressTime = null;
                this.interactions[b].isPressed = false;
                this.interactions[b].source = null;
                this.interactions[b].sourceName = null;
            }
        }
    }

    isButtonLocked(button: Button): boolean {
        return (this.buttonLock === button || this.buttonLock2 === button);
    }

    setButtonLock(button: Button): void {
        if (this.buttonLock === button || this.buttonLock2 === button) return;
        if (this.buttonLock === button) this.buttonLock2 = button;
        else if (this.buttonLock2 === button) this.buttonLock = button;
        else if(!!this.buttonLock) this.buttonLock2 = button;
        else this.buttonLock = button;
    }

    releaseButtonLock(button: Button): void {
        if (this.buttonLock === button) this.buttonLock = null;
        else if (this.buttonLock2 === button) this.buttonLock2 = null;
    }
}