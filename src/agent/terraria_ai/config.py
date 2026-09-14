"""
Configuration settings for Terraria AI Agent.
"""

from dataclasses import dataclass, field
from typing import Dict, Tuple, List
import yaml
import os


@dataclass
class ScreenConfig:
    """Screen capture configuration."""
    width: int = 1920
    height: int = 1080
    capture_fps: int = 30
    region: Tuple[int, int, int, int] = None  # (x, y, width, height) or None for full screen


@dataclass
class KeyBindings:
    """Terraria key bindings (default)."""
    move_left: str = "a"
    move_right: str = "d"
    jump: str = "space"
    grapple: str = "e"
    inventory: str = "escape"
    quick_mount: str = "r"
    quick_heal: str = "h"
    quick_mana: str = "j"
    quick_buff: str = "b"
    hotbar_1: str = "1"
    hotbar_2: str = "2"
    hotbar_3: str = "3"
    hotbar_4: str = "4"
    hotbar_5: str = "5"
    hotbar_6: str = "6"
    hotbar_7: str = "7"
    hotbar_8: str = "8"
    hotbar_9: str = "9"
    hotbar_10: str = "0"
    auto_select: str = "shift"
    smart_cursor: str = "ctrl"
    use_item: str = "left_click"
    interact: str = "right_click"


@dataclass
class GameConstants:
    """Terraria game constants."""
    # Block sizes (in pixels at 1920x1080)
    block_size: int = 16

    # NPC House requirements
    house_min_width: int = 10  # blocks
    house_min_height: int = 6  # blocks
    house_min_area: int = 60   # blocks squared

    # Entity detection colors (approximate RGB ranges)
    zombie_colors: List[Tuple[int, int, int]] = field(default_factory=lambda: [
        (72, 59, 58),   # Dark zombie skin
        (94, 76, 73),   # Zombie skin
        (61, 75, 53),   # Green zombie
    ])

    eye_of_cthulhu_colors: List[Tuple[int, int, int]] = field(default_factory=lambda: [
        (220, 220, 220),  # White of eye
        (200, 50, 50),    # Red iris
        (180, 40, 40),    # Dark red
    ])

    player_health_bar_color: Tuple[int, int, int] = (255, 0, 0)
    player_mana_bar_color: Tuple[int, int, int] = (0, 0, 255)

    # Block colors (approximate)
    dirt_color: Tuple[int, int, int] = (151, 107, 75)
    stone_color: Tuple[int, int, int] = (128, 128, 128)
    wood_color: Tuple[int, int, int] = (168, 125, 68)

    # UI positions (at 1920x1080)
    health_bar_pos: Tuple[int, int] = (1770, 30)
    mana_bar_pos: Tuple[int, int] = (1770, 60)
    inventory_start: Tuple[int, int] = (50, 260)
    hotbar_start: Tuple[int, int] = (50, 30)
    hotbar_slot_size: int = 52


@dataclass
class AIConfig:
    """AI behavior configuration."""
    # Combat settings
    combat_range: int = 300  # pixels
    flee_health_threshold: float = 0.25  # 25% health
    attack_cooldown: float = 0.1  # seconds

    # Mining settings
    mining_depth_limit: int = 500  # pixels from surface
    preferred_mining_direction: str = "down"

    # Building settings
    house_style: str = "basic"  # basic, wood, stone
    house_width: int = 12
    house_height: int = 8

    # Movement settings
    movement_speed: float = 0.05  # key hold time
    jump_height: int = 6  # blocks

    # Decision making
    decision_interval: float = 0.1  # seconds between decisions
    exploration_radius: int = 800  # pixels


class Config:
    """Main configuration class."""

    def __init__(self, config_path: str = None):
        self.screen = ScreenConfig()
        self.keys = KeyBindings()
        self.game = GameConstants()
        self.ai = AIConfig()

        if config_path and os.path.exists(config_path):
            self.load(config_path)

    def load(self, path: str):
        """Load configuration from YAML file."""
        with open(path, 'r') as f:
            data = yaml.safe_load(f)

        if 'screen' in data:
            for key, value in data['screen'].items():
                if hasattr(self.screen, key):
                    setattr(self.screen, key, value)

        if 'keys' in data:
            for key, value in data['keys'].items():
                if hasattr(self.keys, key):
                    setattr(self.keys, key, value)

        if 'ai' in data:
            for key, value in data['ai'].items():
                if hasattr(self.ai, key):
                    setattr(self.ai, key, value)

    def save(self, path: str):
        """Save configuration to YAML file."""
        data = {
            'screen': {
                'width': self.screen.width,
                'height': self.screen.height,
                'capture_fps': self.screen.capture_fps,
            },
            'keys': {
                'move_left': self.keys.move_left,
                'move_right': self.keys.move_right,
                'jump': self.keys.jump,
                'inventory': self.keys.inventory,
            },
            'ai': {
                'combat_range': self.ai.combat_range,
                'flee_health_threshold': self.ai.flee_health_threshold,
                'house_width': self.ai.house_width,
                'house_height': self.ai.house_height,
            }
        }

        with open(path, 'w') as f:
            yaml.dump(data, f, default_flow_style=False)


# Global config instance
config = Config()
