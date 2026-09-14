"""
Game state tracking for Terraria AI Agent.
Maintains awareness of player status, world state, and game context.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
from enum import Enum, auto
import time
import numpy as np

from .vision import Vision, DetectedObject
from .config import config


class GamePhase(Enum):
    """Current phase of the game."""
    PRE_BOSS = auto()
    EYE_OF_CTHULHU = auto()
    KING_SLIME = auto()
    EATER_OF_WORLDS = auto()
    BRAIN_OF_CTHULHU = auto()
    SKELETRON = auto()
    WALL_OF_FLESH = auto()
    HARDMODE = auto()


class TimeOfDay(Enum):
    """In-game time of day."""
    DAY = auto()
    NIGHT = auto()
    BLOOD_MOON = auto()
    ECLIPSE = auto()


class PlayerState(Enum):
    """Current state of the player."""
    IDLE = auto()
    MOVING = auto()
    MINING = auto()
    BUILDING = auto()
    FIGHTING = auto()
    FLEEING = auto()
    INVENTORY = auto()
    DEAD = auto()


@dataclass
class InventorySlot:
    """Represents an inventory slot."""
    item_name: Optional[str] = None
    stack_size: int = 0
    is_empty: bool = True


@dataclass
class PlayerInfo:
    """Player-related information."""
    health: float = 1.0
    max_health: int = 100
    mana: float = 1.0
    max_mana: int = 20
    position: Tuple[int, int] = (0, 0)
    state: PlayerState = PlayerState.IDLE
    facing_direction: str = "right"

    # Equipment
    current_hotbar_slot: int = 1
    has_pickaxe: bool = True
    has_weapon: bool = True
    has_building_materials: bool = False

    # Buffs/Debuffs
    buffs: List[str] = field(default_factory=list)
    debuffs: List[str] = field(default_factory=list)


@dataclass
class WorldInfo:
    """World-related information."""
    time_of_day: TimeOfDay = TimeOfDay.DAY
    game_phase: GamePhase = GamePhase.PRE_BOSS
    spawn_point: Optional[Tuple[int, int]] = None

    # Exploration data
    explored_left: int = 0
    explored_right: int = 0
    explored_depth: int = 0

    # Structure tracking
    npc_houses_built: int = 0
    npcs_housed: List[str] = field(default_factory=list)


@dataclass
class CombatInfo:
    """Combat-related tracking."""
    enemies_nearby: List[DetectedObject] = field(default_factory=list)
    boss_active: bool = False
    active_boss: Optional[str] = None
    last_damage_taken: float = 0.0
    kills: Dict[str, int] = field(default_factory=dict)


class GameState:
    """
    Maintains the current state of the game.
    """

    def __init__(self, vision: Vision):
        self.vision = vision
        self.player = PlayerInfo()
        self.world = WorldInfo()
        self.combat = CombatInfo()

        # Inventory tracking
        self.hotbar: List[InventorySlot] = [InventorySlot() for _ in range(10)]
        self.inventory: List[List[InventorySlot]] = [
            [InventorySlot() for _ in range(10)] for _ in range(5)
        ]

        # State history for decision making
        self.state_history: List[Dict] = []
        self.max_history = 100

        # Timing
        self.last_update = 0
        self.update_interval = 0.1  # seconds

    def update(self) -> None:
        """Update game state from current screen."""
        current_time = time.time()
        if current_time - self.last_update < self.update_interval:
            return

        frame = self.vision.capture_screen()
        self._update_player_info(frame)
        self._update_world_info(frame)
        self._update_combat_info(frame)

        # Save to history
        self._save_state_snapshot()
        self.last_update = current_time

    def _update_player_info(self, frame: np.ndarray) -> None:
        """Update player-related state."""
        # Update health and mana
        self.player.health = self.vision.get_health_percentage(frame)
        self.player.mana = self.vision.get_mana_percentage(frame)

        # Update position
        player_pos = self.vision.find_player_position(frame)
        if player_pos:
            self.player.position = player_pos

        # Check if inventory is open
        if self.vision.is_inventory_open(frame):
            self.player.state = PlayerState.INVENTORY

        # Check if player might be dead (very low health that stays at 0)
        if self.player.health <= 0:
            self.player.state = PlayerState.DEAD

    def _update_world_info(self, frame: np.ndarray) -> None:
        """Update world-related state."""
        # Check time of day
        if self.vision.detect_night_time(frame):
            self.world.time_of_day = TimeOfDay.NIGHT
        else:
            self.world.time_of_day = TimeOfDay.DAY

    def _update_combat_info(self, frame: np.ndarray) -> None:
        """Update combat-related state."""
        # Find nearby enemies
        enemies = self.vision.find_enemies(frame)
        self.combat.enemies_nearby = enemies

        # Check for bosses
        self.combat.boss_active = False
        self.combat.active_boss = None

        for enemy in enemies:
            if enemy.name == 'eye_of_cthulhu':
                self.combat.boss_active = True
                self.combat.active_boss = 'eye_of_cthulhu'
                break

        # Update player state based on combat
        if self.combat.enemies_nearby and self.player.state not in [
            PlayerState.DEAD, PlayerState.INVENTORY
        ]:
            if self.player.health < config.ai.flee_health_threshold:
                self.player.state = PlayerState.FLEEING
            else:
                self.player.state = PlayerState.FIGHTING

    def _save_state_snapshot(self) -> None:
        """Save current state to history."""
        snapshot = {
            'timestamp': time.time(),
            'health': self.player.health,
            'position': self.player.position,
            'state': self.player.state,
            'enemies_count': len(self.combat.enemies_nearby),
            'time_of_day': self.world.time_of_day,
        }

        self.state_history.append(snapshot)

        # Limit history size
        if len(self.state_history) > self.max_history:
            self.state_history.pop(0)

    def get_nearest_enemy(self) -> Optional[DetectedObject]:
        """Get the nearest enemy to the player."""
        if not self.combat.enemies_nearby:
            return None

        player_x, player_y = self.player.position

        nearest = None
        nearest_dist = float('inf')

        for enemy in self.combat.enemies_nearby:
            enemy_x, enemy_y = enemy.center
            dist = ((enemy_x - player_x) ** 2 + (enemy_y - player_y) ** 2) ** 0.5

            if dist < nearest_dist:
                nearest_dist = dist
                nearest = enemy

        return nearest

    def get_enemies_in_range(self, range_pixels: int) -> List[DetectedObject]:
        """Get all enemies within a certain range."""
        if not self.combat.enemies_nearby:
            return []

        player_x, player_y = self.player.position
        in_range = []

        for enemy in self.combat.enemies_nearby:
            enemy_x, enemy_y = enemy.center
            dist = ((enemy_x - player_x) ** 2 + (enemy_y - player_y) ** 2) ** 0.5

            if dist <= range_pixels:
                in_range.append(enemy)

        return in_range

    def is_in_danger(self) -> bool:
        """Check if player is in a dangerous situation."""
        return (
            self.player.health < config.ai.flee_health_threshold or
            self.combat.boss_active or
            len(self.combat.enemies_nearby) > 3
        )

    def is_night(self) -> bool:
        """Check if it's night time."""
        return self.world.time_of_day in [TimeOfDay.NIGHT, TimeOfDay.BLOOD_MOON]

    def should_flee(self) -> bool:
        """Determine if the player should flee from combat."""
        return (
            self.player.health < config.ai.flee_health_threshold and
            len(self.combat.enemies_nearby) > 0
        )

    def get_health_trend(self, samples: int = 10) -> float:
        """
        Get the trend of health changes.

        Returns:
            Positive = gaining health, Negative = losing health
        """
        if len(self.state_history) < samples:
            return 0.0

        recent = self.state_history[-samples:]
        health_values = [s['health'] for s in recent]

        if len(health_values) < 2:
            return 0.0

        # Simple linear trend
        return health_values[-1] - health_values[0]

    def record_kill(self, enemy_type: str) -> None:
        """Record an enemy kill."""
        if enemy_type not in self.combat.kills:
            self.combat.kills[enemy_type] = 0
        self.combat.kills[enemy_type] += 1

    def record_house_built(self) -> None:
        """Record that an NPC house was built."""
        self.world.npc_houses_built += 1

    def get_status_summary(self) -> str:
        """Get a human-readable status summary."""
        return f"""
=== Game State Summary ===
Player Health: {self.player.health * 100:.1f}%
Player Mana: {self.player.mana * 100:.1f}%
Player State: {self.player.state.name}
Time of Day: {self.world.time_of_day.name}
Enemies Nearby: {len(self.combat.enemies_nearby)}
Boss Active: {self.combat.boss_active} ({self.combat.active_boss or 'None'})
Houses Built: {self.world.npc_houses_built}
Total Kills: {sum(self.combat.kills.values())}
"""

    def to_dict(self) -> Dict:
        """Convert state to dictionary for logging/debugging."""
        return {
            'player': {
                'health': self.player.health,
                'mana': self.player.mana,
                'position': self.player.position,
                'state': self.player.state.name,
            },
            'world': {
                'time_of_day': self.world.time_of_day.name,
                'game_phase': self.world.game_phase.name,
                'houses_built': self.world.npc_houses_built,
            },
            'combat': {
                'enemies_nearby': len(self.combat.enemies_nearby),
                'boss_active': self.combat.boss_active,
                'kills': self.combat.kills,
            }
        }
