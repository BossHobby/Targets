<img src="https://github.com/BossHobby/QUICKSILVER/blob/master/misc/Logo_Clean.svg?raw=true" width="256">

# QUICKSILVER Targets

Target configurations for the [QUICKSILVER Flight Controller Firmware](https://github.com/BossHobby/QUICKSILVER). Contains 500+ flight controller definitions with automatic DMA assignment optimization.

## Quick Start

```bash
npm install
npm run targets -- --help    # Show all commands
npm run targets build         # Build target index
npm run targets dma           # Process DMA assignments
npm test                      # Run tests
```

## Target Format

```yaml
name: matekf405
manufacturer: MTKS
mcu: stm32f405
motor_pins: [PC8, PC9, PC6, PC7]
gyro: {port: 1, nss: PC2}
dma:
  DSHOT_DMAR: {dma: DMA2_STREAM2, channel: 7, tag: TIMER8}
```

## Contributing

1. Create target YAML in `targets/`
2. Run `npm run targets validate && npm run targets dma`
3. Submit pull request

See [CLAUDE.md](CLAUDE.md) for how this AI slob came to be.
