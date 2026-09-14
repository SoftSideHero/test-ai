"""
Combat controller for Terraria AI Agent.
Handles fighting enemies including zombies and bosses like Eye of Cthulhu.
"""

import time
import math
from typing import Tuple, Optional, List
from enum import Enum, auto
from dataclasses import dataclass

from ..input_controller import InputController
from ..game_state import GameState
from ..vision import Vision, DetectedObject
from ..config import config
from .inventory import InventoryManager
from .movement import MovementController, Direction


class CombatStyle(Enum):
    """Combat approach."""
    MELEE = auto()      # Get close and swing
    RANGED = auto()     # Keep distance, shoot
    MAGIC = auto()      # Use magic weapons
    SUMMON = auto()     # Let summons fight
    DEFENSIVE = auto()  # Focus on survival


class EnemyType(Enum):
    """Types of enemies."""
    ZOMBIE = auto()
    DEMON_EYE = auto()
    SLIME = auto()
    EYE_OF_CTHULHU = auto()
    KING_SLIME = auto()
    GENERIC = auto()


@dataclass
class CombatTarget:
    """A target for combat."""
    enemy: DetectedObject
    enemy_type: EnemyType
    priority: int
    distance: float
    threat_level: int


class CombatController:
    """
    Controls combat against enemies.
    Specialized handling for:
    - Zombies (basic melee enemies, spawn at night)
    - Eye of Cthulhu (first boss, flies and charges)
    """

    def __init__(self, input_controller: InputController,
                 game_state: GameState, vision: Vision,
                 inventory: InventoryManager,
                 movement: MovementController):
        self.input = input_controller
        self.state = game_state
        self.vision = vision
        self.inventory = inventory
        self.movement = movement

        # Combat settings
        self.combat_range = config.ai.combat_range
        self.flee_health = config.ai.flee_health_threshold
        self.attack_cooldown = config.ai.attack_cooldown

        # State
        self.is_fighting = False
        self.current_target: Optional[CombatTarget] = None
        self.combat_style = CombatStyle.MELEE
        self.last_attack_time = 0

        # Hotbar slots for weapons
        self.melee_slot = 2
        self.ranged_slot = 3
        self.magic_slot = 7

        # Combat stats
        self.kills = {'zombie': 0, 'skeleton': 0, 'eye_of_cthulhu': 0, 'blue_slime': 0, 'other': 0}
        self.damage_taken = 0

    def engage_combat(self) -> bool:
        """
        Engage in combat with nearby enemies.

        Returns:
            True if enemies were engaged
        """
        self.state.update()
        enemies = self.state.combat.enemies_nearby

        if not enemies:
            self.is_fighting = False
            return False

        self.is_fighting = True

        # Prioritize targets
        targets = self._prioritize_targets(enemies)

        if targets:
            self.current_target = targets[0]
            return self._attack_target(self.current_target)

        return False

    def _prioritize_targets(self, enemies: List[DetectedObject]) -> List[CombatTarget]:
        """
        Prioritize enemies by threat and distance.

        Args:
            enemies: List of detected enemies

        Returns:
            Sorted list of combat targets
        """
        player_x, player_y = self.state.player.position
        targets = []

        for enemy in enemies:
            enemy_x, enemy_y = enemy.center
            distance = ((enemy_x - player_x) ** 2 +
                       (enemy_y - player_y) ** 2) ** 0.5

            # Determine enemy type
            if enemy.name == 'zombie':
                enemy_type = EnemyType.ZOMBIE
                threat = 2
                priority = 3
            elif enemy.name == 'skeleton':
                enemy_type = EnemyType.GENERIC  # Treat as generic humanoid
                threat = 3  # Higher threat than zombies
                priority = 2  # High priority - they hit hard
            elif enemy.name == 'blue_slime':
                enemy_type = EnemyType.SLIME
                threat = 1
                priority = 4
            elif enemy.name == 'eye_of_cthulhu':
                enemy_type = EnemyType.EYE_OF_CTHULHU
                threat = 10
                priority = 1  # Highest priority
            else:
                enemy_type = EnemyType.GENERIC
                threat = 1
                priority = 5

            # Adjust priority by distance
            if distance < 100:
                priority -= 1  # Higher priority for close enemies

            targets.append(CombatTarget(
                enemy=enemy,
                enemy_type=enemy_type,
                priority=priority,
                distance=distance,
                threat_level=threat
            ))

        # Sort by priority (lower is higher priority), then by distance
        targets.sort(key=lambda t: (t.priority, t.distance))

        return targets

    def _attack_target(self, target: CombatTarget) -> bool:
        """
        Attack a specific target.

        Args:
            target: The target to attack

        Returns:
            True if attack was executed
        """
        current_time = time.time()
        if current_time - self.last_attack_time < self.attack_cooldown:
            return False

        # Choose combat approach based on enemy type
        if target.enemy_type == EnemyType.EYE_OF_CTHULHU:
            return self._fight_eye_of_cthulhu(target)
        elif target.enemy_type == EnemyType.ZOMBIE:
            return self._fight_zombie(target)
        elif target.enemy_type == EnemyType.SLIME:
            return self._fight_slime(target)
        else:
            return self._fight_generic(target)

    def _fight_zombie(self, target: CombatTarget) -> bool:
        """
        Fight a zombie.

        Zombies are slow melee enemies that walk toward the player.
        Best fought with melee weapons or from above with ranged.

        Args:
            target: Zombie target

        Returns:
            True if attack executed
        """
        enemy = target.enemy
        enemy_x, enemy_y = enemy.center
        player_x, player_y = self.state.player.position

        # Select melee weapon
        self.inventory.select_slot(self.melee_slot)
        time.sleep(0.02)

        if target.distance < 150:
            # Close enough for melee
            self.input.attack(enemy_x, enemy_y, duration=0.1)
            self.last_attack_time = time.time()

            # If too close, jump to avoid damage
            if target.distance < 50:
                self.movement.jump(0.15)

            return True
        else:
            # Move toward zombie
            if enemy_x > player_x:
                self.movement.move_right(0.1)
            else:
                self.movement.move_left(0.1)

            # Jump attack for safety
            self.movement.jump(0.1)
            self.input.attack(enemy_x, enemy_y, duration=0.1)
            self.last_attack_time = time.time()

            return True

    def _fight_slime(self, target: CombatTarget) -> bool:
        """
        Fight a slime (green or blue).

        Slimes are simple enemies that hop toward the player.
        Easy to kill with any weapon, just hit them!

        Args:
            target: Slime target

        Returns:
            True if attack executed
        """
        enemy = target.enemy
        enemy_x, enemy_y = enemy.center
        player_x, player_y = self.state.player.position

        # Select melee weapon (slimes are easy, melee is fine)
        self.inventory.select_slot(self.melee_slot)
        time.sleep(0.02)

        if target.distance < 200:
            # Close enough to attack
            self.input.attack(enemy_x, enemy_y, duration=0.1)
            self.last_attack_time = time.time()

            # Jump on top of slimes to avoid damage
            if target.distance < 80:
                self.movement.jump(0.1)

            return True
        else:
            # Move toward slime
            if enemy_x > player_x:
                self.movement.move_right(0.15)
            else:
                self.movement.move_left(0.15)

            return True

    def _fight_eye_of_cthulhu(self, target: CombatTarget) -> bool:
        """
        Fight the Eye of Cthulhu boss.

        Eye of Cthulhu behavior:
        - Phase 1: Hovers and summons Servants of Cthulhu, occasionally charges
        - Phase 2 (below 50% health): More aggressive charges

        Strategy:
        - Keep moving to avoid charges
        - Use ranged/magic weapons
        - Stay on platforms if available
        - Heal when below 50% health

        Args:
            target: Eye of Cthulhu target

        Returns:
            True if action taken
        """
        enemy = target.enemy
        enemy_x, enemy_y = enemy.center
        player_x, player_y = self.state.player.position

        # Check if we should heal
        if self.state.player.health < 0.5:
            self.inventory.use_quick_heal()
            time.sleep(0.1)

        # Use ranged weapon for boss fights
        self.inventory.select_slot(self.ranged_slot)
        time.sleep(0.02)

        # Predict movement - Eye tends to move toward player
        # Aim slightly ahead
        aim_x = enemy_x
        aim_y = enemy_y

        # Keep distance
        if target.distance < 200:
            # Too close, move away
            if enemy_x > player_x:
                self.movement.move_left(0.15)
            else:
                self.movement.move_right(0.15)
            self.movement.jump(0.15)

        # Attack while moving
        self.input.aim_and_shoot(aim_x, aim_y)
        self.last_attack_time = time.time()

        # Continuous evasive movement
        if time.time() % 2 < 1:
            # Move left
            self.movement.move_left(0.1)
        else:
            # Move right
            self.movement.move_right(0.1)

        # Jump periodically to avoid charges
        if time.time() % 0.5 < 0.1:
            self.movement.jump(0.2)

        return True

    def _fight_generic(self, target: CombatTarget) -> bool:
        """
        Fight a generic enemy.

        Args:
            target: Enemy target

        Returns:
            True if attack executed
        """
        enemy = target.enemy
        enemy_x, enemy_y = enemy.center

        self.inventory.select_slot(self.melee_slot)
        time.sleep(0.02)

        self.input.attack(enemy_x, enemy_y, duration=0.1)
        self.last_attack_time = time.time()

        return True

    def flee_from_combat(self):
        """
        Flee from combat (when health is low).
        """
        self.state.update()
        enemies = self.state.combat.enemies_nearby

        if not enemies:
            return

        # Find average enemy position
        total_x = sum(e.center[0] for e in enemies)
        avg_x = total_x / len(enemies)

        player_x, player_y = self.state.player.position

        # Move away from average enemy position
        if avg_x > player_x:
            self.movement.move_left(0.3)
        else:
            self.movement.move_right(0.3)

        # Jump to escape
        self.movement.jump(0.2)

        # Use grapple if available
        # self.input.grapple()

    def kite_enemies(self, duration: float = 5.0):
        """
        Kite enemies (hit and run tactics).

        Args:
            duration: How long to kite
        """
        end_time = time.time() + duration
        direction = Direction.RIGHT

        while time.time() < end_time:
            self.state.update()
            enemies = self.state.combat.enemies_nearby

            if not enemies:
                break

            # Find nearest enemy
            nearest = self._prioritize_targets(enemies)[0] if enemies else None

            if nearest:
                enemy_x, enemy_y = nearest.enemy.center
                player_x, player_y = self.state.player.position

                # Attack if in range
                if nearest.distance < 200:
                    self.inventory.select_slot(self.ranged_slot)
                    self.input.aim_and_shoot(enemy_x, enemy_y)

                # Move away
                if enemy_x > player_x:
                    self.movement.move_left(0.1)
                    direction = Direction.LEFT
                else:
                    self.movement.move_right(0.1)
                    direction = Direction.RIGHT

                # Jump occasionally
                if time.time() % 0.8 < 0.1:
                    self.movement.jump(0.15)

            # Check health
            if self.state.player.health < self.flee_health:
                self.flee_from_combat()
                break

            time.sleep(0.05)

    def defend_position(self, x: int, y: int, duration: float = 10.0):
        """
        Defend a specific position, attacking anything that comes near.

        Args:
            x: X position to defend
            y: Y position to defend
            duration: How long to defend
        """
        end_time = time.time() + duration

        while time.time() < end_time:
            self.state.update()
            enemies = self.state.get_enemies_in_range(self.combat_range)

            for enemy_obj in enemies:
                enemy_x, enemy_y = enemy_obj.center

                # Attack enemy
                self.inventory.select_slot(self.melee_slot)
                self.input.attack(enemy_x, enemy_y, 0.1)
                time.sleep(0.1)

            # Return to position if drifted
            player_x, player_y = self.state.player.position
            if abs(player_x - x) > 50:
                if player_x > x:
                    self.movement.move_left(0.1)
                else:
                    self.movement.move_right(0.1)

            # Check health
            if self.state.player.health < self.flee_health:
                self.flee_from_combat()
                break

            time.sleep(0.05)

    def summon_eye_of_cthulhu(self):
        """
        Attempt to summon Eye of Cthulhu using Suspicious Looking Eye.
        Must be night time.
        """
        if not self.state.is_night():
            print("Cannot summon Eye of Cthulhu - must be night time")
            return False

        # Suspicious Looking Eye should be in inventory
        # Select the slot containing it (user configured)
        # For now, assume it's in slot 10
        self.inventory.select_slot(10)
        time.sleep(0.1)

        # Use item
        player_x, player_y = self.state.player.position
        self.input.click(player_x, player_y)

        return True

    def record_kill(self, enemy_type: str):
        """Record an enemy kill."""
        if enemy_type in self.kills:
            self.kills[enemy_type] += 1
        else:
            self.kills['other'] += 1

        self.state.record_kill(enemy_type)

    def should_heal(self) -> bool:
        """Check if player should use healing potion."""
        return self.state.player.health < 0.5

    def auto_heal(self):
        """Automatically heal if needed."""
        if self.should_heal():
            self.inventory.use_quick_heal()

    def configure_weapon_slots(self, melee: int = 2, ranged: int = 3,
                               magic: int = 7):
        """
        Configure weapon hotbar slots.

        Args:
            melee: Slot for melee weapon
            ranged: Slot for ranged weapon
            magic: Slot for magic weapon
        """
        self.melee_slot = melee
        self.ranged_slot = ranged
        self.magic_slot = magic

    def set_combat_style(self, style: CombatStyle):
        """Set the preferred combat style."""
        self.combat_style = style

    def get_combat_stats(self) -> dict:
        """Get combat statistics."""
        return {
            'kills': self.kills.copy(),
            'is_fighting': self.is_fighting,
            'combat_style': self.combat_style.name,
            'current_target': self.current_target.enemy.name if self.current_target else None,
        }

    def cleanup(self):
        """Clean up combat state."""
        self.is_fighting = False
        self.current_target = None
