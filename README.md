<img src="https://github.com/BossHobby/QUICKSILVER/blob/master/misc/Logo_Clean.svg?raw=true" width="256">

# QUICKSILVER Targets

This repository holds target configurations for the [QUICKSILVER Flight Controller Firmware](https://github.com/BossHobby/QUICKSILVER)

See the folder `targets` for existing targets.

GPIO switches use up to four `pinio` entries, in the same order as their receiver
AUX assignments. Each needs a pin and label (up to 31 UTF-8 bytes); descriptions
are optional (up to 95 UTF-8 bytes). For example:

```yaml
pinio:
  - pin: PC6
    label: VTX power
    description: Power supply for the video transmitter
    invert: false
  - pin: PB5
    label: Camera select
    description: Select the secondary camera when active
    invert: true
```

`invert` defaults to false; true makes logical on drive low. Each output follows
its receiver AUX assignment, including Always on/off, on the ground and in flight.
Fresh profiles default to Always off. SWD pins PA13/PA14 remain available for
debugging until the output is first switched on with the receiver ready.
Target changes require a reboot. The
new firmware uses `pinio`; serial VTX pit mode is a separate AUX function.
Keep existing `fpv: <pin>` entries alongside the matching PINIO entry so older
firmware can still use the same YAML. When using PINIO for VTX power, select
Always on or assign a channel.

The folder `staging` holds targets converted from the [Betaflight configs](https://github.com/betaflight/config/) as a starting point for creating new targets.

Initialize the pinned Betaflight configs with `git submodule update --init`.
`npm run translate` imports `PINIO1_PIN` through `PINIO4_PIN`, their inversion
configuration, and USER box names through `PINIOx_BOX` / `BOX_USERx_NAME`.
Unnamed outputs use `PINIO n`. Descriptions can be added to the YAML manually.
Run `npm test` for PINIO import checks. INAV-derived PINIO entries are maintained
manually in the YAMLs; check the exact board variant and `PINIOx_FLAGS` polarity
when updating them.

PINIO pins must not also be assigned to LEDs, serial ports, or other hardware.
Target generation rejects those conflicts; the legacy `fpv` alias is allowed.
Staged Betaflight imports can contain alternative assignments from upstream;
resolve those before promoting a target.
