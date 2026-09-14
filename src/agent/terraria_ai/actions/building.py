"""
Building controller for Terraria AI Agent.
Handles structure building, especially NPC houses.
"""

import time
from typing import Tuple, Optional, List
from enum import Enum, auto
from dataclasses import dataclass

from ..input_controller import InputController
from ..game_state import GameState
from ..vision import Vision
from ..config import config
from .inventory import InventoryManager
from .mining import MiningController


class HouseStyle(Enum):
    """Style of NPC house to build."""
    BASIC = auto()      # Minimal valid house
    WOOD = auto()       # Wooden house
    STONE = auto()      # Stone house
    BRICK = auto()      # Brick house


@dataclass
class HouseBlueprint:
    """Blueprint for an NPC house."""
    width: int = 10      # Interior width
    height: int = 6      # Interior height
    wall_thickness: int = 1
    has_door: bool = True
    has_chair: bool = True
    has_table: bool = True
    has_light: bool = True
    style: HouseStyle = HouseStyle.BASIC


class BuildingController:
    """
    Controls building operations for creating structures.
    Primary focus is NPC houses.

    NPC Housing Requirements in Terraria:
    - Minimum 60 tiles of floor space (width * height)
    - Solid blocks for walls, floor, ceiling
    - Background walls (player-placed)
    - A door or platform for entry
    - A flat surface item (table, workbench)
    - A comfort item (chair, bed)
    - A light source (torch, candle)
    """

    def __init__(self, input_controller: InputController,
                 game_state: GameState, vision: Vision,
                 inventory: InventoryManager, mining: MiningController):
        self.input = input_controller
        self.state = game_state
        self.vision = vision
        self.inventory = inventory
        self.mining = mining

        # Block size for positioning
        self.block_size = config.game.block_size

        # Default house blueprint
        self.blueprint = HouseBlueprint(
            width=config.ai.house_width,
            height=config.ai.house_height
        )

        # Building state
        self.is_building = False
        self.houses_built = 0

        # Slot configuration (user should set these based on their inventory)
        self.block_slot = 4         # Hotbar slot for building blocks
        self.wall_slot = 5          # Hotbar slot for walls
        self.door_slot = 6          # Hotbar slot for doors
        self.torch_slot = 7         # Hotbar slot for torches
        self.furniture_slot = 8     # Hotbar slot for furniture (table/chair)

    def build_npc_house(self, start_x: int = None, start_y: int = None,
                        blueprint: HouseBlueprint = None) -> bool:
        """
        Build a complete NPC house.

        This builds a simple box house near the player.
        Make sure you have:
        - Slot 4: Building blocks (wood, stone, etc.)
        - Slot 5: Background walls
        - Slot 6: Door
        - Slot 7: Torch
        - Slot 8: Table/Workbench
        - Slot 9: Chair

        Returns:
            True if house was built successfully
        """
        self.is_building = True

        # Get screen center (where player is)
        frame = self.vision.capture_screen()
        center_x = frame.shape[1] // 2
        center_y = frame.shape[0] // 2

        # Block spacing (pixels between each block placement)
        # Terraria blocks are about 16 pixels, but we space out more for reliability
        spacing = 20

        print("Building floor (pass 1)...")
        self.inventory.select_slot(self.block_slot)
        time.sleep(0.3)

        # Build floor (10 blocks wide, at player feet level - not underground)
        # Do two passes to ensure all blocks are placed
        floor_y = center_y + 35  # At player feet, not below ground
        for i in range(10):
            x = center_x - 100 + (i * spacing)
            self.input.hold_click(x, floor_y, duration=0.25)
            time.sleep(0.15)

        print("Building floor (pass 2)...")
        time.sleep(0.3)
        for i in range(10):
            x = center_x - 100 + (i * spacing)
            self.input.hold_click(x, floor_y, duration=0.25)
            time.sleep(0.15)

        print("Building left wall (pass 1)...")
        time.sleep(0.3)
        # Build left wall (6 blocks tall)
        wall_x = center_x - 100
        for i in range(6):
            y = floor_y - 20 - (i * spacing)
            self.input.hold_click(wall_x, y, duration=0.25)
            time.sleep(0.15)

        print("Building left wall (pass 2)...")
        time.sleep(0.3)
        for i in range(6):
            y = floor_y - 20 - (i * spacing)
            self.input.hold_click(wall_x, y, duration=0.25)
            time.sleep(0.15)

        print("Building right wall (pass 1)...")
        time.sleep(0.3)
        # Build right wall (6 blocks tall)
        wall_x = center_x + 80
        for i in range(6):
            y = floor_y - 20 - (i * spacing)
            self.input.hold_click(wall_x, y, duration=0.25)
            time.sleep(0.15)

        print("Building right wall (pass 2)...")
        time.sleep(0.3)
        for i in range(6):
            y = floor_y - 20 - (i * spacing)
            self.input.hold_click(wall_x, y, duration=0.25)
            time.sleep(0.15)

        print("Building ceiling (pass 1)...")
        time.sleep(0.3)
        # Build ceiling
        ceiling_y = floor_y - 120
        for i in range(10):
            x = center_x - 100 + (i * spacing)
            self.input.hold_click(x, ceiling_y, duration=0.25)
            time.sleep(0.15)

        print("Building ceiling (pass 2)...")
        time.sleep(0.3)
        for i in range(10):
            x = center_x - 100 + (i * spacing)
            self.input.hold_click(x, ceiling_y, duration=0.25)
            time.sleep(0.15)

        print("Placing background walls (pass 1)...")
        # Place background walls (slot 5) - start at floor level
        self.inventory.select_slot(self.wall_slot)
        time.sleep(0.3)

        for row in range(6):  # Extra row to cover more area
            for col in range(8):
                x = center_x - 80 + (col * spacing)
                y = floor_y - 5 - (row * spacing)  # Start very close to floor
                self.input.hold_click(x, y, duration=0.2)
                time.sleep(0.1)

        print("Placing background walls (pass 2)...")
        time.sleep(0.3)
        for row in range(6):
            for col in range(8):
                x = center_x - 80 + (col * spacing)
                y = floor_y - 5 - (row * spacing)
                self.input.hold_click(x, y, duration=0.2)
                time.sleep(0.1)

        print("Placing torch...")
        # Place torch (slot 7) - on wall, middle height of house
        self.inventory.select_slot(self.torch_slot)
        time.sleep(0.3)
        self.input.hold_click(center_x, floor_y - 70, duration=0.3)
        time.sleep(0.3)
        # Try a second position in case first didn't work
        self.input.hold_click(center_x - 20, floor_y - 70, duration=0.3)
        time.sleep(0.3)

        print("Placing table...")
        # Place table (slot 8) - on the floor inside the house
        self.inventory.select_slot(self.furniture_slot)
        time.sleep(0.3)
        self.input.hold_click(center_x - 40, floor_y - 25, duration=0.3)
        time.sleep(0.3)
        # Try again to make sure
        self.input.hold_click(center_x - 40, floor_y - 25, duration=0.3)
        time.sleep(0.3)

        print("Placing chair...")
        # Place chair (slot 9) - on the floor inside the house
        self.inventory.select_slot(9)
        time.sleep(0.3)
        self.input.hold_click(center_x + 20, floor_y - 25, duration=0.3)
        time.sleep(0.3)
        # Try again to make sure
        self.input.hold_click(center_x + 20, floor_y - 25, duration=0.3)
        time.sleep(0.3)

        print("Breaking wall for door...")
        # Place door (slot 6) - need to break wall blocks first
        self.inventory.select_slot(1)  # Select pickaxe
        time.sleep(0.3)
        # Break 3 blocks in the right wall for door space (from bottom up)
        # Hold longer to ensure blocks break
        door_x = center_x + 80
        self.input.hold_click(door_x, floor_y - 25, duration=0.8)
        time.sleep(0.3)
        self.input.hold_click(door_x, floor_y - 45, duration=0.8)
        time.sleep(0.3)
        self.input.hold_click(door_x, floor_y - 65, duration=0.8)
        time.sleep(0.3)

        print("Placing door...")
        # Place door at the bottom of the opening
        self.inventory.select_slot(self.door_slot)
        time.sleep(0.3)
        self.input.hold_click(door_x, floor_y - 25, duration=0.4)
        time.sleep(0.3)
        # Try again to make sure door is placed
        self.input.hold_click(door_x, floor_y - 25, duration=0.4)
        time.sleep(0.3)

        self.houses_built += 1
        self.is_building = False
        print("House building complete!")
        return True

    def _build_floor(self, start_x: int, y: int, length: int):
        """
        Build a horizontal line of blocks (floor/ceiling).

        Args:
            start_x: Starting X position
            y: Y position
            length: Number of blocks
        """
        self.inventory.select_slot(self.block_slot)
        time.sleep(0.05)

        for i in range(length):
            x = start_x + i * self.block_size
            self.input.place_block(x, y)
            time.sleep(0.1)

    def _build_wall(self, x: int, start_y: int, height: int, vertical: bool = True):
        """
        Build a vertical wall.

        Args:
            x: X position
            start_y: Starting Y position (bottom)
            height: Number of blocks high
            vertical: Build vertically if True
        """
        self.inventory.select_slot(self.block_slot)
        time.sleep(0.05)

        for i in range(height):
            y = start_y - i * self.block_size
            self.input.place_block(x, y)
            time.sleep(0.1)

    def _fill_background_walls(self, start_x: int, start_y: int,
                               width: int, height: int):
        """
        Fill an area with background walls.

        Args:
            start_x: Top-left X
            start_y: Top-left Y
            width: Width in blocks
            height: Height in blocks
        """
        self.inventory.select_slot(self.wall_slot)
        time.sleep(0.05)

        for row in range(height):
            for col in range(width):
                x = start_x + col * self.block_size
                y = start_y - row * self.block_size
                self.input.place_block(x, y)
                time.sleep(0.05)

    def _place_door(self, x: int, y: int):
        """
        Place a door.

        Args:
            x: X position
            y: Y position (ground level)
        """
        # First, remove 3 blocks for door space
        self.mining.mine_at_position(x, y)
        time.sleep(0.3)
        self.mining.mine_at_position(x, y - self.block_size)
        time.sleep(0.3)
        self.mining.mine_at_position(x, y - 2 * self.block_size)
        time.sleep(0.3)

        # Place door
        self.inventory.select_slot(self.door_slot)
        time.sleep(0.05)
        self.input.place_block(x, y)
        time.sleep(0.1)

    def _place_table(self, x: int, y: int):
        """Place a table/workbench."""
        self.inventory.select_slot(self.furniture_slot)
        time.sleep(0.05)
        self.input.place_block(x, y)
        time.sleep(0.1)

    def _place_chair(self, x: int, y: int):
        """Place a chair."""
        # Assumes chair is in furniture slot or next slot
        self.inventory.select_slot(self.furniture_slot)
        self.inventory.cycle_hotbar_forward()
        time.sleep(0.05)
        self.input.place_block(x, y)
        time.sleep(0.1)

    def _place_torch(self, x: int, y: int):
        """Place a torch."""
        self.inventory.select_slot(self.torch_slot)
        time.sleep(0.05)
        self.input.place_block(x, y)
        time.sleep(0.1)

    def build_platform(self, start_x: int, y: int, length: int):
        """
        Build a platform (wood platform blocks).

        Args:
            start_x: Starting X position
            y: Y position
            length: Number of blocks
        """
        # Assumes platforms are in block slot
        self.inventory.select_slot(self.block_slot)
        time.sleep(0.05)

        for i in range(length):
            x = start_x + i * self.block_size
            self.input.place_block(x, y)
            time.sleep(0.08)

    def build_arena(self, width: int = 100, height: int = 50,
                    platform_spacing: int = 10):
        """
        Build a boss arena with platforms.

        Args:
            width: Arena width in blocks
            height: Arena height in blocks
            platform_spacing: Space between platform rows
        """
        player_x, player_y = self.state.player.position

        # Build multiple platform rows
        num_rows = height // platform_spacing

        for row in range(num_rows):
            y = player_y - row * platform_spacing * self.block_size
            start_x = player_x - (width // 2) * self.block_size

            self.build_platform(start_x, y, width)
            time.sleep(0.5)

            # Check for danger
            self.state.update()
            if self.state.is_in_danger():
                break

    def build_bridge(self, length: int, direction: str = 'right'):
        """
        Build a bridge in a direction.

        Args:
            length: Bridge length in blocks
            direction: 'left' or 'right'
        """
        self.inventory.select_slot(self.block_slot)
        time.sleep(0.05)

        player_x, player_y = self.state.player.position
        dx = self.block_size if direction == 'right' else -self.block_size

        for i in range(length):
            x = player_x + (i + 1) * dx
            y = player_y + self.block_size  # Below player

            self.input.place_block(x, y)
            time.sleep(0.1)

            # Move forward
            if direction == 'right':
                self.input.move_right(0.1)
            else:
                self.input.move_left(0.1)
            time.sleep(0.1)

    def build_shelter(self):
        """
        Build a quick emergency shelter (minimal walls for protection).
        """
        player_x, player_y = self.state.player.position

        # Build a small box around player
        self.inventory.select_slot(self.block_slot)
        time.sleep(0.05)

        # Left wall (3 high)
        for i in range(3):
            self.input.place_block(
                player_x - 2 * self.block_size,
                player_y - i * self.block_size
            )
            time.sleep(0.1)

        # Right wall (3 high)
        for i in range(3):
            self.input.place_block(
                player_x + 2 * self.block_size,
                player_y - i * self.block_size
            )
            time.sleep(0.1)

        # Ceiling
        for i in range(-2, 3):
            self.input.place_block(
                player_x + i * self.block_size,
                player_y - 3 * self.block_size
            )
            time.sleep(0.1)

    def configure_building_slots(self, block: int = 4, wall: int = 5,
                                 door: int = 6, torch: int = 7,
                                 furniture: int = 8):
        """
        Configure which hotbar slots contain building materials.

        Args:
            block: Slot for solid blocks (1-10)
            wall: Slot for background walls
            door: Slot for doors
            torch: Slot for torches
            furniture: Slot for furniture
        """
        self.block_slot = block
        self.wall_slot = wall
        self.door_slot = door
        self.torch_slot = torch
        self.furniture_slot = furniture

    def check_housing_valid(self) -> bool:
        """
        Check if we're near a valid NPC house.
        This is a simplified check - full validation would require
        the game's housing query feature.

        Returns:
            True if structure might be valid housing
        """
        # In a full implementation, we'd use the housing query
        # For now, return True if we've built houses
        return self.houses_built > 0

    def get_build_stats(self) -> dict:
        """Get building statistics."""
        return {
            'houses_built': self.houses_built,
            'is_building': self.is_building,
        }

    def cleanup(self):
        """Clean up building state."""
        self.is_building = False
