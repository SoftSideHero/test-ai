# Terraria AI Agent

An autonomous AI that plays Terraria, capable of building NPC houses, mining blocks, fighting enemies (including bosses), navigating the world, and managing inventory.

## Features

- **NPC House Building**: Automatically builds valid housing for NPCs with walls, doors, furniture, and lighting
- **Mining**: Mines stone, dirt, and ores with various patterns (hellevator, horizontal tunnels, staircases)
- **Combat**: Fights zombies, demon eyes, and bosses like the Eye of Cthulhu
- **World Navigation**: Explores, jumps, and navigates terrain
- **Inventory Management**: Selects appropriate tools/weapons, uses healing items
- **Intelligent Decision Making**: Prioritizes survival, adapts to day/night cycles

## Requirements

- Python 3.8+
- Terraria running in windowed mode at 1920x1080
- Windows/Linux with display server

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/terraria-ai-agent.git
cd terraria-ai-agent

# Install dependencies
pip install -r requirements.txt
```

## Usage

### Basic Usage

```bash
# Run in automatic mode
python main.py

# Run in interactive mode
python main.py --mode interactive

# Run demo mode
python main.py --mode demo
```

### Mode Options

```bash
# Build NPC houses
python main.py --mode build

# Mining mode
python main.py --mode mine --duration 300

# Combat training
python main.py --mode combat

# Set initial goal
python main.py --goal boss  # Fight Eye of Cthulhu
```

### Hotbar Configuration

Configure which slots contain specific items:

```bash
# Format: pickaxe,sword,ranged,building,torch
python main.py --hotbar 1,2,3,4,5
```

### Interactive Commands

When running in interactive mode:

| Command | Description |
|---------|-------------|
| `build` | Build an NPC house |
| `mine` | Start mining |
| `fight` | Engage combat |
| `boss` | Fight Eye of Cthulhu (night only) |
| `explore` | Explore the world |
| `status` | Show current status |
| `stop` | Stop current action |
| `quit` | Exit the program |

## Architecture

```
terraria_ai/
├── __init__.py          # Package initialization
├── ai_agent.py          # Main AI controller
├── config.py            # Configuration settings
├── game_state.py        # Game state tracking
├── input_controller.py  # Keyboard/mouse control
├── vision.py            # Screen capture & analysis
├── actions/
│   ├── building.py      # NPC house construction
│   ├── combat.py        # Fighting enemies/bosses
│   ├── inventory.py     # Item management
│   ├── mining.py        # Block mining
│   └── movement.py      # Player navigation
└── detection/
    ├── blocks.py        # Block detection
    ├── entities.py      # Enemy/NPC detection
    └── ui.py            # UI element detection
```

## Configuration

Create a `config.yaml` file to customize settings:

```yaml
screen:
  width: 1920
  height: 1080
  capture_fps: 30

keys:
  move_left: a
  move_right: d
  jump: space
  inventory: escape

ai:
  combat_range: 300
  flee_health_threshold: 0.25
  house_width: 12
  house_height: 8
```

## How It Works

### Vision System
- Captures screen using `mss` for fast screenshots
- Uses OpenCV for color-based object detection
- Detects enemies by their characteristic colors and shapes
- Identifies blocks, UI elements, and game state

### Decision Making
- Maintains game state (health, position, enemies, time of day)
- Prioritizes survival (flees when health is low)
- Adapts behavior to day/night cycle
- Queues and executes tasks based on goals

### Combat System
- **Zombies**: Melee combat with jumping to avoid damage
- **Eye of Cthulhu**: Kiting tactics with ranged weapons, continuous movement

### Building System
- Constructs valid NPC housing
- Places walls, floor, ceiling
- Adds door, table, chair, and torch
- Fills background walls

## Limitations

- Requires Terraria to run at specific resolution (1920x1080)
- Detection relies on color matching (may need tuning for different texture packs)
- Cannot read item names directly (uses slot-based inventory)
- Requires manual hotbar setup for optimal performance

## Tips for Best Results

1. Set up your hotbar before starting:
   - Slot 1: Pickaxe
   - Slot 2: Melee weapon
   - Slot 3: Ranged weapon
   - Slot 4: Building blocks
   - Slot 5: Background walls
   - Slot 6: Doors
   - Slot 7: Torches

2. Start with a new character in a new world for consistent results

3. Disable mouse acceleration in your OS for accurate cursor control

4. Run Terraria in windowed borderless mode for best screen capture

## Contributing

Contributions are welcome! Please feel free to submit pull requests.

## License

MIT License - see LICENSE file for details

## Disclaimer

This is an educational project demonstrating game AI and computer vision techniques. Please respect Terraria's terms of service when using this software.
