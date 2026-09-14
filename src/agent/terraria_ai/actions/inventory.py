"""
Inventory management for Terraria AI Agent.
Handles item organization, selection, and management.
"""

import time
from typing import Optional, List, Tuple
from enum import Enum, auto
from dataclasses import dataclass

from ..input_controller import InputController
from ..game_state import GameState
from ..vision import Vision
from ..config import config


class ItemCategory(Enum):
    """Categories of items."""
    WEAPON = auto()
    TOOL = auto()
    PICKAXE = auto()
    AXE = auto()
    HAMMER = auto()
    BUILDING = auto()
    CONSUMABLE = auto()
    ACCESSORY = auto()
    ARMOR = auto()
    MATERIAL = auto()
    FURNITURE = auto()
    MISC = auto()


@dataclass
class Item:
    """Represents an item."""
    name: str
    category: ItemCategory
    stack_size: int = 1
    hotbar_slot: Optional[int] = None
    inventory_slot: Optional[Tuple[int, int]] = None


class InventoryManager:
    """
    Manages player inventory and item selection.
    """

    def __init__(self, input_controller: InputController,
                 game_state: GameState, vision: Vision):
        self.input = input_controller
        self.state = game_state
        self.vision = vision

        # Track known items in hotbar
        self.hotbar_items: List[Optional[Item]] = [None] * 10

        # Expected item placements (configured by user or learned)
        self.item_slots = {
            'pickaxe': 1,      # Slot 1 for pickaxe
            'sword': 2,        # Slot 2 for melee weapon
            'ranged': 3,       # Slot 3 for ranged weapon
            'building': 4,     # Slot 4 for building blocks
            'torch': 5,        # Slot 5 for torches
            'potion': 6,       # Slot 6 for health potions
            'magic': 7,        # Slot 7 for magic weapon
            'grapple': 8,      # Slot 8 for grappling hook (if using hotbar)
            'summon': 9,       # Slot 9 for summon weapon
            'misc': 10,        # Slot 10 for miscellaneous
        }

        self.current_slot = 1
        self.inventory_open = False

    def select_slot(self, slot: int):
        """
        Select a hotbar slot.

        Args:
            slot: Slot number (1-10)
        """
        if 1 <= slot <= 10:
            self.input.select_hotbar_slot(slot)
            self.current_slot = slot
            time.sleep(0.05)

    def select_pickaxe(self):
        """Select the pickaxe slot."""
        self.select_slot(self.item_slots['pickaxe'])

    def select_weapon(self, weapon_type: str = 'sword'):
        """
        Select a weapon.

        Args:
            weapon_type: Type of weapon ('sword', 'ranged', 'magic')
        """
        slot_key = weapon_type if weapon_type in self.item_slots else 'sword'
        self.select_slot(self.item_slots[slot_key])

    def select_building_material(self):
        """Select building materials."""
        self.select_slot(self.item_slots['building'])

    def select_torch(self):
        """Select torches."""
        self.select_slot(self.item_slots['torch'])

    def open_inventory(self):
        """Open the inventory screen."""
        if not self.inventory_open:
            self.input.open_inventory()
            self.inventory_open = True
            time.sleep(0.2)  # Wait for inventory to open

    def close_inventory(self):
        """Close the inventory screen."""
        if self.inventory_open:
            self.input.open_inventory()
            self.inventory_open = False
            time.sleep(0.1)

    def toggle_inventory(self):
        """Toggle inventory open/close."""
        self.input.open_inventory()
        self.inventory_open = not self.inventory_open
        time.sleep(0.1)

    def get_inventory_slot_position(self, col: int, row: int) -> Tuple[int, int]:
        """
        Get screen position of an inventory slot.

        Args:
            col: Column (0-9)
            row: Row (0-4)

        Returns:
            (x, y) screen position
        """
        base_x, base_y = config.game.inventory_start
        slot_size = config.game.hotbar_slot_size

        x = base_x + col * slot_size + slot_size // 2
        y = base_y + row * slot_size + slot_size // 2

        return (x, y)

    def get_hotbar_slot_position(self, slot: int) -> Tuple[int, int]:
        """
        Get screen position of a hotbar slot.

        Args:
            slot: Slot number (0-9)

        Returns:
            (x, y) screen position
        """
        base_x, base_y = config.game.hotbar_start
        slot_size = config.game.hotbar_slot_size

        x = base_x + slot * slot_size + slot_size // 2
        y = base_y + slot_size // 2

        return (x, y)

    def click_inventory_slot(self, col: int, row: int):
        """
        Click on an inventory slot.

        Args:
            col: Column (0-9)
            row: Row (0-4)
        """
        x, y = self.get_inventory_slot_position(col, row)
        self.input.click(x, y)
        time.sleep(0.05)

    def click_hotbar_slot(self, slot: int):
        """
        Click on a hotbar slot.

        Args:
            slot: Slot number (0-9)
        """
        x, y = self.get_hotbar_slot_position(slot)
        self.input.click(x, y)
        time.sleep(0.05)

    def move_item_to_hotbar(self, inv_col: int, inv_row: int, hotbar_slot: int):
        """
        Move an item from inventory to hotbar.

        Args:
            inv_col: Inventory column
            inv_row: Inventory row
            hotbar_slot: Target hotbar slot (0-9)
        """
        self.open_inventory()

        # Pick up item from inventory
        self.click_inventory_slot(inv_col, inv_row)
        time.sleep(0.05)

        # Place in hotbar
        self.click_hotbar_slot(hotbar_slot)
        time.sleep(0.05)

    def move_item_in_inventory(self, from_pos: Tuple[int, int],
                               to_pos: Tuple[int, int]):
        """
        Move an item within the inventory.

        Args:
            from_pos: (col, row) of source slot
            to_pos: (col, row) of destination slot
        """
        self.open_inventory()

        # Pick up item
        self.click_inventory_slot(from_pos[0], from_pos[1])
        time.sleep(0.05)

        # Place item
        self.click_inventory_slot(to_pos[0], to_pos[1])
        time.sleep(0.05)

    def swap_hotbar_items(self, slot1: int, slot2: int):
        """
        Swap two items in the hotbar.

        Args:
            slot1: First slot (0-9)
            slot2: Second slot (0-9)
        """
        self.open_inventory()

        # Pick up first item
        self.click_hotbar_slot(slot1)
        time.sleep(0.05)

        # Click second slot (picks up item there, places first)
        self.click_hotbar_slot(slot2)
        time.sleep(0.05)

        # Place remaining item in first slot
        self.click_hotbar_slot(slot1)
        time.sleep(0.05)

    def use_quick_heal(self):
        """Use quick heal (consumes health potion)."""
        self.input.quick_heal()

    def use_quick_mana(self):
        """Use quick mana (consumes mana potion)."""
        self.input.quick_mana()

    def use_quick_buff(self):
        """Use all buff potions."""
        self.input.quick_buff()

    def trash_held_item(self):
        """Trash the currently held item (in cursor)."""
        self.open_inventory()

        # Click on trash can (bottom of inventory)
        trash_x = config.game.inventory_start[0] + 9 * config.game.hotbar_slot_size
        trash_y = config.game.inventory_start[1] + 5 * config.game.hotbar_slot_size

        self.input.click(trash_x, trash_y)
        time.sleep(0.05)

    def sort_inventory(self):
        """
        Sort inventory (if auto-sort is available).
        Clicks the sort button in inventory.
        """
        self.open_inventory()

        # Sort button is typically near the inventory
        sort_x = config.game.inventory_start[0] + 10 * config.game.hotbar_slot_size + 30
        sort_y = config.game.inventory_start[1] + 20

        self.input.click(sort_x, sort_y)
        time.sleep(0.1)

    def deposit_all(self):
        """
        Deposit all items to nearby chest (Quick Stack All).
        """
        self.open_inventory()

        # Quick stack button
        stack_x = config.game.inventory_start[0] + 10 * config.game.hotbar_slot_size + 30
        stack_y = config.game.inventory_start[1] + 60

        self.input.click(stack_x, stack_y)
        time.sleep(0.1)

    def configure_hotbar_for_combat(self):
        """
        Set up hotbar for combat scenario.
        Selects weapon slot.
        """
        self.select_weapon('sword')

    def configure_hotbar_for_mining(self):
        """
        Set up hotbar for mining.
        Selects pickaxe slot.
        """
        self.select_pickaxe()

    def configure_hotbar_for_building(self):
        """
        Set up hotbar for building.
        Selects building material slot.
        """
        self.select_building_material()

    def cycle_hotbar_forward(self):
        """Cycle to next hotbar slot."""
        next_slot = (self.current_slot % 10) + 1
        self.select_slot(next_slot)

    def cycle_hotbar_backward(self):
        """Cycle to previous hotbar slot."""
        prev_slot = ((self.current_slot - 2) % 10) + 1
        self.select_slot(prev_slot)

    def is_inventory_full(self) -> bool:
        """
        Check if inventory appears full.

        Returns:
            True if inventory seems full
        """
        # This would need to analyze the inventory screen
        # For now, return False as a default
        return False

    def get_current_item_name(self) -> Optional[str]:
        """Get the name of the currently selected item."""
        if self.hotbar_items[self.current_slot - 1]:
            return self.hotbar_items[self.current_slot - 1].name
        return None

    def set_item_slot_mapping(self, item_type: str, slot: int):
        """
        Configure which slot an item type should be in.

        Args:
            item_type: Type of item ('pickaxe', 'sword', etc.)
            slot: Slot number (1-10)
        """
        if 1 <= slot <= 10:
            self.item_slots[item_type] = slot

    def cleanup(self):
        """Clean up inventory state."""
        if self.inventory_open:
            self.close_inventory()
