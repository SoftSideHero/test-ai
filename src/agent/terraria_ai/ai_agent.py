"""
Main AI Agent for Terraria.
Orchestrates all systems to play the game autonomously.
"""

import time
import logging
from typing import Optional, Callable
from enum import Enum, auto
from dataclasses import dataclass

from .vision import Vision
from .input_controller import InputController
from .game_state import GameState, PlayerState
from .config import config, Config
from .actions.movement import MovementController
from .actions.inventory import InventoryManager
from .actions.mining import MiningController
from .actions.building import BuildingController
from .actions.combat import CombatController


# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('TerrariaAI')


class AIGoal(Enum):
    """High-level goals for the AI."""
    IDLE = auto()
    EXPLORE = auto()
    GATHER_RESOURCES = auto()
    BUILD_HOUSE = auto()
    MINE = auto()
    FIGHT = auto()
    SURVIVE = auto()
    BOSS_FIGHT = auto()


@dataclass
class AITask:
    """A task for the AI to complete."""
    goal: AIGoal
    priority: int
    description: str
    completed: bool = False
    progress: float = 0.0


class TerrariaAI:
    """
    Main AI controller that plays Terraria.

    Capabilities:
    - Build NPC houses
    - Mine blocks (stone, dirt, ores)
    - Fight zombies and Eye of Cthulhu
    - Navigate the world
    - Manage inventory
    """

    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize the Terraria AI.

        Args:
            config_path: Optional path to configuration file
        """
        # Load configuration
        if config_path:
            config.load(config_path)

        # Initialize core systems
        logger.info("Initializing Terraria AI Agent...")

        self.vision = Vision()
        self.input = InputController()
        self.state = GameState(self.vision)

        # Initialize action controllers
        self.movement = MovementController(self.input, self.state)
        self.inventory = InventoryManager(self.input, self.state, self.vision)
        self.mining = MiningController(self.input, self.state, self.vision,
                                       self.inventory)
        self.building = BuildingController(self.input, self.state, self.vision,
                                           self.inventory, self.mining)
        self.combat = CombatController(self.input, self.state, self.vision,
                                       self.inventory, self.movement)

        # AI state
        self.running = False
        self.current_goal = AIGoal.IDLE
        self.task_queue: list = []

        # Callbacks for external control
        self.on_goal_complete: Optional[Callable] = None
        self.on_death: Optional[Callable] = None

        # Statistics
        self.stats = {
            'play_time': 0,
            'deaths': 0,
            'houses_built': 0,
            'blocks_mined': 0,
            'enemies_killed': 0,
        }

        logger.info("Terraria AI Agent initialized successfully!")

    def start(self):
        """Start the AI agent."""
        logger.info("Starting Terraria AI Agent...")
        self.running = True
        self._main_loop()

    def stop(self):
        """Stop the AI agent."""
        logger.info("Stopping Terraria AI Agent...")
        self.running = False
        self.cleanup()

    def _main_loop(self):
        """Main decision and action loop."""
        start_time = time.time()

        while self.running:
            try:
                # Update game state
                self.state.update()

                # Check for critical situations
                if self._check_critical_situations():
                    continue

                # Execute current goal
                self._execute_goal()

                # Update statistics
                self.stats['play_time'] = time.time() - start_time

                # Small delay to prevent CPU overuse
                time.sleep(config.ai.decision_interval)

            except KeyboardInterrupt:
                logger.info("Interrupted by user")
                break
            except Exception as e:
                logger.error(f"Error in main loop: {e}")
                time.sleep(1)

        self.stop()

    def _check_critical_situations(self) -> bool:
        """
        Check for situations that need immediate response.

        Returns:
            True if a critical situation was handled
        """
        # Check if dead
        if self.state.player.state == PlayerState.DEAD:
            logger.warning("Player died!")
            self.stats['deaths'] += 1
            if self.on_death:
                self.on_death()
            time.sleep(5)  # Wait for respawn
            return True

        # Check if health is critically low
        if self.state.should_flee():
            logger.warning("Health critical - fleeing!")
            self.combat.flee_from_combat()
            self.inventory.use_quick_heal()
            return True

        # Check for nearby enemies during non-combat goals
        if (self.current_goal not in [AIGoal.FIGHT, AIGoal.BOSS_FIGHT, AIGoal.SURVIVE]
            and self.state.combat.enemies_nearby):
            logger.info("Enemies detected - engaging combat!")
            self.current_goal = AIGoal.FIGHT
            return True

        return False

    def _execute_goal(self):
        """Execute the current goal."""
        if self.current_goal == AIGoal.IDLE:
            self._goal_idle()
        elif self.current_goal == AIGoal.EXPLORE:
            self._goal_explore()
        elif self.current_goal == AIGoal.GATHER_RESOURCES:
            self._goal_gather()
        elif self.current_goal == AIGoal.BUILD_HOUSE:
            self._goal_build_house()
        elif self.current_goal == AIGoal.MINE:
            self._goal_mine()
        elif self.current_goal == AIGoal.FIGHT:
            self._goal_fight()
        elif self.current_goal == AIGoal.SURVIVE:
            self._goal_survive()
        elif self.current_goal == AIGoal.BOSS_FIGHT:
            self._goal_boss_fight()

    def _goal_idle(self):
        """Idle behavior - decide what to do next."""
        logger.debug("Idle - deciding next action...")

        # Check task queue
        if self.task_queue:
            task = self.task_queue.pop(0)
            self.current_goal = task.goal
            logger.info(f"Starting task: {task.description}")
            return

        # Default behavior based on game state
        if self.state.is_night():
            # Night time - be defensive
            logger.info("Night time - switching to survival mode")
            self.current_goal = AIGoal.SURVIVE
        elif self.state.world.npc_houses_built < 3:
            # Need more houses
            logger.info("Need more NPC houses - building")
            self.current_goal = AIGoal.BUILD_HOUSE
        else:
            # Explore and gather
            logger.info("Exploring and gathering resources")
            self.current_goal = AIGoal.EXPLORE

    def _goal_explore(self):
        """Explore the world."""
        # Move in a direction
        if time.time() % 10 < 5:
            self.movement.move_right(0.1)
        else:
            self.movement.move_left(0.1)

        # Jump occasionally
        if time.time() % 2 < 0.1:
            self.movement.jump(0.15)

        # Check if stuck
        if self.movement.is_stuck():
            self.movement.unstick()

    def _goal_gather(self):
        """Gather resources."""
        # Try to mine nearby blocks
        if self.mining.mine_stone():
            self.stats['blocks_mined'] += 1
        elif self.mining.mine_dirt():
            self.stats['blocks_mined'] += 1
        else:
            # No blocks nearby, explore to find more
            self.current_goal = AIGoal.EXPLORE

    def _goal_build_house(self):
        """Build an NPC house."""
        logger.info("Building NPC house...")

        # Find a suitable location
        frame = self.vision.capture_screen()
        location = self.vision.find_suitable_building_area(frame)

        if location:
            # Build the house
            if self.building.build_npc_house(location[0], location[1]):
                self.stats['houses_built'] += 1
                logger.info(f"House built! Total: {self.stats['houses_built']}")

                if self.on_goal_complete:
                    self.on_goal_complete(AIGoal.BUILD_HOUSE)

        # Return to idle after building
        self.current_goal = AIGoal.IDLE

    def _goal_mine(self):
        """Mine blocks."""
        # Choose mining pattern
        if config.ai.preferred_mining_direction == 'down':
            self.mining.mine_below()
        else:
            # Horizontal mining
            self.mining.dig_horizontal_tunnel('right', 10)

        self.stats['blocks_mined'] += 1

    def _goal_fight(self):
        """Fight nearby enemies."""
        if not self.state.combat.enemies_nearby:
            logger.info("No more enemies - returning to idle")
            self.current_goal = AIGoal.IDLE
            return

        # Check for bosses
        if self.state.combat.boss_active:
            self.current_goal = AIGoal.BOSS_FIGHT
            return

        # Fight regular enemies
        if self.combat.engage_combat():
            # Check if enemy was killed
            prev_enemies = len(self.state.combat.enemies_nearby)
            time.sleep(0.5)
            self.state.update()
            current_enemies = len(self.state.combat.enemies_nearby)

            if current_enemies < prev_enemies:
                self.stats['enemies_killed'] += 1
                self.combat.record_kill('zombie')

        # Auto heal if needed
        self.combat.auto_heal()

    def _goal_survive(self):
        """Survival mode - defensive play during night or danger."""
        # Build shelter if exposed
        if not self.state.world.npc_houses_built:
            self.building.build_shelter()

        # Fight enemies that get close
        if self.state.combat.enemies_nearby:
            self.combat.engage_combat()
        else:
            # Stay in place, be ready
            pass

        # Return to normal when day comes
        if not self.state.is_night() and not self.state.combat.enemies_nearby:
            logger.info("Day time - switching to normal operations")
            self.current_goal = AIGoal.IDLE

    def _goal_boss_fight(self):
        """Fight a boss (Eye of Cthulhu)."""
        logger.info(f"Boss fight: {self.state.combat.active_boss}")

        if not self.state.combat.boss_active:
            logger.info("Boss defeated!")
            self.stats['enemies_killed'] += 1
            self.combat.record_kill(self.state.combat.active_boss or 'boss')
            self.current_goal = AIGoal.IDLE
            return

        # Use kiting tactics for boss
        self.combat.kite_enemies(duration=2.0)

        # Keep healing
        self.combat.auto_heal()

    # Public API methods

    def set_goal(self, goal: AIGoal):
        """
        Set the current goal.

        Args:
            goal: The goal to pursue
        """
        logger.info(f"Goal set to: {goal.name}")
        self.current_goal = goal

    def add_task(self, task: AITask):
        """
        Add a task to the queue.

        Args:
            task: Task to add
        """
        self.task_queue.append(task)
        self.task_queue.sort(key=lambda t: t.priority)

    def build_house(self):
        """Command: Build an NPC house."""
        self.add_task(AITask(
            goal=AIGoal.BUILD_HOUSE,
            priority=1,
            description="Build NPC house"
        ))

    def mine_resources(self, duration: float = 60):
        """
        Command: Mine resources for a duration.

        Args:
            duration: Mining duration in seconds
        """
        self.add_task(AITask(
            goal=AIGoal.MINE,
            priority=2,
            description=f"Mine for {duration} seconds"
        ))

    def fight_enemies(self):
        """Command: Engage in combat."""
        self.set_goal(AIGoal.FIGHT)

    def summon_eye_of_cthulhu(self):
        """Command: Summon and fight Eye of Cthulhu."""
        if self.state.is_night():
            self.combat.summon_eye_of_cthulhu()
            self.set_goal(AIGoal.BOSS_FIGHT)
        else:
            logger.warning("Cannot summon Eye of Cthulhu - must be night time")

    def explore(self, direction: str = 'right'):
        """
        Command: Explore in a direction.

        Args:
            direction: 'left' or 'right'
        """
        self.set_goal(AIGoal.EXPLORE)

    def configure_hotbar(self, pickaxe: int = 1, sword: int = 2,
                        ranged: int = 3, building: int = 4,
                        torch: int = 5):
        """
        Configure hotbar slot assignments.

        Args:
            pickaxe: Slot for pickaxe
            sword: Slot for melee weapon
            ranged: Slot for ranged weapon
            building: Slot for building blocks
            torch: Slot for torches
        """
        self.inventory.set_item_slot_mapping('pickaxe', pickaxe)
        self.inventory.set_item_slot_mapping('sword', sword)
        self.inventory.set_item_slot_mapping('ranged', ranged)
        self.inventory.set_item_slot_mapping('building', building)
        self.inventory.set_item_slot_mapping('torch', torch)

        self.combat.configure_weapon_slots(melee=sword, ranged=ranged)
        self.building.configure_building_slots(block=building, torch=torch)

    def get_stats(self) -> dict:
        """Get current statistics."""
        return {
            **self.stats,
            'current_goal': self.current_goal.name,
            'health': self.state.player.health,
            'position': self.state.player.position,
            'time_of_day': self.state.world.time_of_day.name,
            'enemies_nearby': len(self.state.combat.enemies_nearby),
        }

    def get_status(self) -> str:
        """Get a human-readable status string."""
        stats = self.get_stats()
        return f"""
=== Terraria AI Status ===
Goal: {stats['current_goal']}
Health: {stats['health']*100:.1f}%
Time: {stats['time_of_day']}
Enemies Nearby: {stats['enemies_nearby']}

Statistics:
- Play Time: {stats['play_time']:.0f}s
- Deaths: {stats['deaths']}
- Houses Built: {stats['houses_built']}
- Blocks Mined: {stats['blocks_mined']}
- Enemies Killed: {stats['enemies_killed']}
"""

    def cleanup(self):
        """Clean up resources."""
        logger.info("Cleaning up...")
        self.movement.cleanup()
        self.inventory.cleanup()
        self.mining.cleanup()
        self.building.cleanup()
        self.combat.cleanup()
        self.input.cleanup()
        self.vision.cleanup()
        logger.info("Cleanup complete")

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.cleanup()
        return False
