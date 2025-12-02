# Icons Setup Guide

This directory contains icons for the ClaimRewards table.

## Directory Structure

```
public/
├── networks/       # Network/Chain icons
├── protocols/      # Protocol/Source icons
└── tokens/         # Token icons
```

## Required Icons

### Networks (public/networks/)
- ethereum.svg
- lisk.svg
- arbitrum.svg
- optimism.svg
- base.svg

### Protocols (public/protocols/)
- aave.svg
- morpho.svg
- compound.svg
- gmx.svg

### Tokens (public/tokens/)
- aave.svg
- usdc.svg
- eth.svg
- weth.svg
- gmx.svg
- usdt.svg

## Icon Requirements
- Format: SVG (recommended) or PNG
- Size: 24x24px minimum
- Background: Transparent
- Style: Circular or square (will be rendered as circular)

## Where to Find Icons
- **Tokens**: https://github.com/trustwallet/assets or https://cryptologos.cc/
- **Networks**: Official brand assets from respective chains
- **Protocols**: Official brand kits from protocol websites

## Fallback Behavior
If an icon is not found, the component will hide the image gracefully and show only the text label.
