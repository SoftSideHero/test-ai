"""
Mining controller for Terraria AI Agent.
Handles block mining and resource gathering.
"""

import time
from typing import Tuple, Optional, List
from enum import Enum, auto
from dataclasses import dataclass

from ..input_controller import InputController
from ..game_state import GameState
from ..vision import Vision, DetectedObject
from ..config import config
from .inventory import InventoryManager


class MiningDirection(Enum):
    """Mining direction patterns."""
    DOWN = auto()       # Mine straight down
    LEFT = auto()       # Mine to the left
    RIGHT = auto()      # Mine to the right
    HELLEVATOR = auto() # Mine a 2-wide shaft down
    HORIZONTAL = auto() # Mine horizontal tunnel
    STAIRCASE = auto()  # Mine in a staircase pattern


@dataclass
class MiningTarget:
    """A target block to mine."""
    x: int
    y: int
    block_type: str
    priority: int = 0


class MiningController:
    """
    Controls mining operations.
    Note: Terraria has stone blocks, not cobblestone (that's Minecraft).
    We mine stone, dirt, ores, and other blocks.
    """

    def __init__(self, input_controller: InputController,
                 game_state: GameState, vision: Vision,
                 inventory: InventoryManager):
        self.input = input_controller
        self.state = game_state
        self.vision = vision
        self.inventory = inventory

        # Mining settings
        self.mine_duration = 0.3  # Base time to hold click for mining
        self.block_size = config.game.block_size

        # Current mining state
        self.is_mining = False
        self.current_target: Optional[MiningTarget] = None
        self.blocks_mined = 0

        # Mining patterns
        self.mining_direction = MiningDirection.DOWN

    def mine_at_position(self, x: int, y: int, duration: float = None):
        """
        Mine a block at a specific screen position.

        Args:
            x: Screen X coordinate
            y: Screen Y coordinate
            duration: How long to mine (None for auto)
        """
        if duration is None:
            duration = self.mine_duration

        # Make sure pickaxe is selected
        self.inventory.select_pickaxe()
        time.sleep(0.05)

        # Mine the block
        self.input.mine_block(x, y, duration)
        self.is_mining = True

    def mine_block_relative(self, dx: int, dy: int, duration: float = None):
        """
        Mine a block relative to player position.

        Args:
            dx: Blocks to the right (negative for left)
            dy: Blocks down (negative for up)
            duration: Mining duration
        """
        player_x, player_y = self.state.player.position

        target_x = player_x + dx * self.block_size
        target_y = player_y + dy * self.block_size

        self.mine_at_position(target_x, target_y, duration)

    def mine_below(self, duration: float = None):
        """Mine the block directly below the player."""
        self.mine_block_relative(0, 2, duration)  # 2 blocks down (feet level + 1)

    def mine_above(self, duration: float = None):
        """Mine the block directly above the player."""
        self.mine_block_relative(0, -2, duration)  # 2 blocks up (head level + 1)

    def mine_left(self, duration: float = None):
        """Mine the block to the left of the player."""
        self.mine_block_relative(-2, 0, duration)

    def mine_right(self, duration: float = None):
        """Mine the block to the right of the player."""
        self.mine_block_relative(2, 0, duration)

    def mine_stone(self) -> bool:
        """
        Find and mine stone blocks nearby.

        Returns:
            True if found stone to mine, False otherwise
        """
        frame = self.vision.capture_screen()
        stone_blocks = self.vision.find_blocks(frame, 'stone')

        if not stone_blocks:
            return False

        # Find nearest stone block
        player_x, player_y = self.state.player.position
        nearest = None
        nearest_dist = float('inf')

        for block in stone_blocks:
            bx, by = block.center
            dist = ((bx - player_x) ** 2 + (by - player_y) ** 2) ** 0.5

            if dist < nearest_dist and dist < 200:  # Within mining range
                nearest_dist = dist
                nearest = block

        if nearest:
            self.mine_at_position(nearest.center[0], nearest.center[1])
            return True

        return False

    def mine_dirt(self) -> bool:
        """
        Find and mine dirt blocks nearby.

        Returns:
            True if found dirt to mine
        """
        frame = self.vision.capture_screen()
        dirt_blocks = self.vision.find_blocks(frame, 'dirt')

        if not dirt_blocks:
            return False

        player_x, player_y = self.state.player.position
        nearest = None
        nearest_dist = float('inf')

        for block in dirt_blocks:
            bx, by = block.center
            dist = ((bx - player_x) ** 2 + (by - player_y) ** 2) ** 0.5

            if dist < nearest_dist and dist < 200:
                nearest_dist = dist
                nearest = block

        if nearest:
            self.mine_at_position(nearest.center[0], nearest.center[1])
            return True

        return False

    def dig_hellevator(self, width: int = 2, depth: int = 100):
        """
        Dig a hellevator (vertical shaft to hell).

        Args:
            width: Width of shaft in blocks
            depth: How deep to dig in blocks
        """
        self.mining_direction = MiningDirection.HELLEVATOR

        for i in range(depth):
            # Mine blocks below
            for w in range(width):
                self.mine_block_relative(w - width // 2, 2)
                time.sleep(0.3)

            # Move down
            time.sleep(0.2)

            # Check for danger
            self.state.update()
            if self.state.is_in_danger():
                break

            # Update blocks mined counter
            self.blocks_mined += width

    def dig_horizontal_tunnel(self, direction: str = 'right', length: int = 50):
        """
        Dig a horizontal tunnel.

        Args:
            direction: 'left' or 'right'
            length: Length in blocks
        """
        self.mining_direction = MiningDirection.HORIZONTAL
        dx = 1 if direction == 'right' else -1

        for i in range(length):
            # Mine blocks at player level (2 high tunnel)
            self.mine_block_relative(dx * 2, 0)  # Middle
            time.sleep(0.2)
            self.mine_block_relative(dx * 2, -1)  # Top
            time.sleep(0.2)

            # Move forward
            if direction == 'right':
                self.input.move_right(0.1)
            else:
                self.input.move_left(0.1)

            time.sleep(0.1)

            # Check for danger
            self.state.update()
            if self.state.is_in_danger():
                break

            self.blocks_mined += 2

    def dig_staircase(self, direction: str = 'right', depth: int = 50):
        """
        Dig a staircase pattern (safer than straight down).

        Args:
            direction: 'left' or 'right'
            depth: How deep to dig
        """
        self.mining_direction = MiningDirection.STAIRCASE
        dx = 1 if direction == 'right' else -1

        for i in range(depth):
            # Mine 3 blocks in stair pattern
            self.mine_block_relative(dx, 0)   # Forward
            time.sleep(0.2)
            self.mine_block_relative(dx, 1)   # Forward-down
            time.sleep(0.2)
            self.mine_block_relative(0, 1)    # Down
            time.sleep(0.2)

            # Move diagonally
            if direction == 'right':
                self.input.move_right(0.1)
            else:
                self.input.move_left(0.1)
            time.sleep(0.2)

            self.state.update()
            if self.state.is_in_danger():
                break

            self.blocks_mined += 3

    def continuous_mine(self, x: int, y: int, duration: float = 5.0):
        """
        Continuously mine at a position for a duration.

        Args:
            x: Target X
            y: Target Y
            duration: Total mining duration
        """
        self.inventory.select_pickaxe()
        time.sleep(0.05)

        # Enable smart cursor for easier mining
        self.input.smart_cursor_toggle()
        time.sleep(0.05)

        # Hold mouse button for continuous mining
        self.input.move_mouse(x, y)

        end_time = time.time() + duration
        while time.time() < end_time:
            self.input.hold_click(x, y, duration=0.1)

            # Check for danger
            self.state.update()
            if self.state.is_in_danger():
                break

    def gather_resources(self, resource_type: str = 'stone',
                        target_count: int = 50) -> int:
        """
        Gather a specific type of resource.

        Args:
            resource_type: Type to gather ('stone', 'dirt', 'wood')
            target_count: How many to gather

        Returns:
            Approximate number gathered
        """
        gathered = 0

        while gathered < target_count:
            frame = self.vision.capture_screen()
            blocks = self.vision.find_blocks(frame, resource_type)

            if not blocks:
                # No more blocks nearby, move to find more
                self.input.move_right(0.5)
                continue

            # Mine nearest block
            player_x, player_y = self.state.player.position

            for block in blocks:
                bx, by = block.center
                dist = ((bx - player_x) ** 2 + (by - player_y) ** 2) ** 0.5

                if dist < 200:  # Within range
                    self.mine_at_position(bx, by)
                    gathered += 1
                    time.sleep(0.3)
                    break

            # Safety check
            self.state.update()
            if self.state.is_in_danger():
                break

        return gathered

    def clear_area(self, width: int, height: int):
        """
        Clear a rectangular area of blocks.

        Args:
            width: Width in blocks
            height: Height in blocks
        """
        player_x, player_y = self.state.player.position

        for row in range(height):
            for col in range(width):
                # Calculate position
                x = player_x - (width // 2 * self.block_size) + col * self.block_size
                y = player_y + row * self.block_size

                # Mine the block
                self.mine_at_position(x, y)
                time.sleep(0.2)

                # Periodic state check
                if col % 5 == 0:
                    self.state.update()
                    if self.state.is_in_danger():
                        return

        self.blocks_mined += width * height

    def stop_mining(self):
        """Stop current mining operation."""
        self.is_mining = False
        self.current_target = None

    def get_mining_stats(self) -> dict:
        """Get mining statistics."""
        return {
            'blocks_mined': self.blocks_mined,
            'is_mining': self.is_mining,
            'direction': self.mining_direction.name,
        }

    def cleanup(self):
        """Clean up mining state."""
        self.stop_mining()
