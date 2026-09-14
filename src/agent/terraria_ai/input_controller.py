"""
Input controller for Terraria AI Agent.
Handles keyboard and mouse input simulation.
"""

import pyautogui
import time
from typing import Tuple, Optional, List
from threading import Thread, Lock
from dataclasses import dataclass
from enum import Enum

from .config import config


class MouseButton(Enum):
    LEFT = "left"
    RIGHT = "right"
    MIDDLE = "middle"


@dataclass
class KeyState:
    """Track the state of a key."""
    pressed: bool = False
    press_time: float = 0.0


class InputController:
    """
    Controls keyboard and mouse input for Terraria.
    """

    def __init__(self):
        # Configure pyautogui for game input
        pyautogui.FAILSAFE = True  # Move mouse to corner to abort
        pyautogui.PAUSE = 0.01  # Small delay between actions

        self.keys = config.keys
        self.key_states: dict = {}
        self.lock = Lock()

        # Track held keys for cleanup
        self.held_keys: set = set()

    def press_key(self, key: str, duration: float = 0.05):
        """
        Press a key for a specified duration.

        Args:
            key: Key to press (e.g., 'a', 'space', 'shift')
            duration: How long to hold the key
        """
        with self.lock:
            pyautogui.keyDown(key)
            self.held_keys.add(key)

        time.sleep(duration)

        with self.lock:
            pyautogui.keyUp(key)
            self.held_keys.discard(key)

    def hold_key(self, key: str):
        """
        Start holding a key down.

        Args:
            key: Key to hold
        """
        with self.lock:
            if key not in self.held_keys:
                pyautogui.keyDown(key)
                self.held_keys.add(key)
                self.key_states[key] = KeyState(pressed=True, press_time=time.time())

    def release_key(self, key: str):
        """
        Release a held key.

        Args:
            key: Key to release
        """
        with self.lock:
            if key in self.held_keys:
                pyautogui.keyUp(key)
                self.held_keys.discard(key)
                if key in self.key_states:
                    self.key_states[key].pressed = False

    def release_all_keys(self):
        """Release all currently held keys."""
        with self.lock:
            for key in list(self.held_keys):
                pyautogui.keyUp(key)
            self.held_keys.clear()
            self.key_states.clear()

    def click(self, x: int, y: int, button: MouseButton = MouseButton.LEFT,
              clicks: int = 1, interval: float = 0.1):
        """
        Click at a specific position.

        Args:
            x: X coordinate
            y: Y coordinate
            button: Mouse button to click
            clicks: Number of clicks
            interval: Interval between clicks
        """
        pyautogui.click(x, y, clicks=clicks, interval=interval, button=button.value)

    def move_mouse(self, x: int, y: int, duration: float = 0.1):
        """
        Move mouse to a position.

        Args:
            x: X coordinate
            y: Y coordinate
            duration: Time to move to position
        """
        pyautogui.moveTo(x, y, duration=duration)

    def drag(self, start: Tuple[int, int], end: Tuple[int, int],
             button: MouseButton = MouseButton.LEFT, duration: float = 0.2):
        """
        Drag from one position to another.

        Args:
            start: Starting (x, y) position
            end: Ending (x, y) position
            button: Mouse button to use
            duration: Duration of the drag
        """
        pyautogui.moveTo(start[0], start[1])
        pyautogui.mouseDown(button=button.value)
        pyautogui.moveTo(end[0], end[1], duration=duration)
        pyautogui.mouseUp(button=button.value)

    def hold_click(self, x: int, y: int, button: MouseButton = MouseButton.LEFT,
                   duration: float = 1.0):
        """
        Hold mouse button at position for duration (for mining/attacking).

        Args:
            x: X coordinate
            y: Y coordinate
            button: Mouse button to hold
            duration: How long to hold
        """
        pyautogui.moveTo(x, y)
        pyautogui.mouseDown(button=button.value)
        time.sleep(duration)
        pyautogui.mouseUp(button=button.value)

    def scroll(self, amount: int, x: int = None, y: int = None):
        """
        Scroll the mouse wheel.

        Args:
            amount: Scroll amount (positive = up, negative = down)
            x: X coordinate (optional)
            y: Y coordinate (optional)
        """
        if x is not None and y is not None:
            pyautogui.moveTo(x, y)
        pyautogui.scroll(amount)

    # Game-specific actions

    def move_left(self, duration: float = None):
        """Move player left."""
        if duration is None:
            duration = config.ai.movement_speed
        self.press_key(self.keys.move_left, duration)

    def move_right(self, duration: float = None):
        """Move player right."""
        if duration is None:
            duration = config.ai.movement_speed
        self.press_key(self.keys.move_right, duration)

    def start_moving_left(self):
        """Start continuous left movement."""
        self.hold_key(self.keys.move_left)

    def start_moving_right(self):
        """Start continuous right movement."""
        self.hold_key(self.keys.move_right)

    def stop_moving(self):
        """Stop horizontal movement."""
        self.release_key(self.keys.move_left)
        self.release_key(self.keys.move_right)

    def jump(self, duration: float = 0.15):
        """
        Make player jump.

        Args:
            duration: How long to hold jump (affects jump height)
        """
        self.press_key(self.keys.jump, duration)

    def hold_jump(self):
        """Start holding jump (for flying mounts or continuous jumping)."""
        self.hold_key(self.keys.jump)

    def release_jump(self):
        """Stop holding jump."""
        self.release_key(self.keys.jump)

    def grapple(self):
        """Use grappling hook."""
        self.press_key(self.keys.grapple, 0.05)

    def open_inventory(self):
        """Toggle inventory open/close."""
        self.press_key(self.keys.inventory, 0.05)

    def quick_heal(self):
        """Use quick heal."""
        self.press_key(self.keys.quick_heal, 0.05)

    def quick_mana(self):
        """Use quick mana."""
        self.press_key(self.keys.quick_mana, 0.05)

    def quick_buff(self):
        """Use all buff potions."""
        self.press_key(self.keys.quick_buff, 0.05)

    def select_hotbar_slot(self, slot: int):
        """
        Select a hotbar slot (1-10).

        Args:
            slot: Slot number (1-10)
        """
        if 1 <= slot <= 10:
            key = getattr(self.keys, f'hotbar_{slot}')
            self.press_key(key, 0.05)

    def use_item(self, x: int, y: int, duration: float = 0.1):
        """
        Use the currently selected item at a position.

        Args:
            x: X coordinate to use item
            y: Y coordinate to use item
            duration: How long to hold (for continuous use items like pickaxes)
        """
        self.hold_click(x, y, MouseButton.LEFT, duration)

    def interact(self, x: int, y: int):
        """
        Interact with something (right click).

        Args:
            x: X coordinate
            y: Y coordinate
        """
        self.click(x, y, MouseButton.RIGHT)

    def smart_cursor_toggle(self):
        """Toggle smart cursor mode."""
        self.press_key(self.keys.smart_cursor, 0.05)

    def auto_select_toggle(self):
        """Toggle auto-select mode."""
        self.press_key(self.keys.auto_select, 0.05)

    # Inventory management

    def inventory_click(self, slot_x: int, slot_y: int):
        """
        Click on an inventory slot.

        Args:
            slot_x: Slot column (0-9)
            slot_y: Slot row (0-4 for main inventory)
        """
        base_x, base_y = config.game.inventory_start
        slot_size = config.game.hotbar_slot_size

        x = base_x + slot_x * slot_size + slot_size // 2
        y = base_y + slot_y * slot_size + slot_size // 2

        self.click(x, y, MouseButton.LEFT)

    def hotbar_click(self, slot: int):
        """
        Click on a hotbar slot.

        Args:
            slot: Slot number (0-9)
        """
        base_x, base_y = config.game.hotbar_start
        slot_size = config.game.hotbar_slot_size

        x = base_x + slot * slot_size + slot_size // 2
        y = base_y + slot_size // 2

        self.click(x, y, MouseButton.LEFT)

    def move_item(self, from_slot: Tuple[int, int], to_slot: Tuple[int, int]):
        """
        Move an item from one inventory slot to another.

        Args:
            from_slot: (x, y) of source slot
            to_slot: (x, y) of destination slot
        """
        # Pick up item
        self.inventory_click(from_slot[0], from_slot[1])
        time.sleep(0.1)

        # Place item
        self.inventory_click(to_slot[0], to_slot[1])

    def quick_stack(self, x: int, y: int):
        """
        Quick stack items to nearby chests (Ctrl+Click).

        Args:
            x: Chest X position
            y: Chest Y position
        """
        with self.lock:
            pyautogui.keyDown('ctrl')
        self.click(x, y, MouseButton.LEFT)
        with self.lock:
            pyautogui.keyUp('ctrl')

    def trash_item(self, slot_x: int, slot_y: int):
        """
        Trash an item from inventory (Shift+Click on trash can).

        Args:
            slot_x: Slot column
            slot_y: Slot row
        """
        # Pick up item first
        self.inventory_click(slot_x, slot_y)
        time.sleep(0.1)

        # Click on trash slot (bottom right of inventory)
        trash_x = config.game.inventory_start[0] + 10 * config.game.hotbar_slot_size
        trash_y = config.game.inventory_start[1] + 5 * config.game.hotbar_slot_size
        self.click(trash_x, trash_y, MouseButton.LEFT)

    # Combat actions

    def attack(self, x: int, y: int, duration: float = 0.1):
        """
        Attack at a position.

        Args:
            x: X coordinate to attack
            y: Y coordinate to attack
            duration: Attack duration (for weapons with wind-up)
        """
        self.use_item(x, y, duration)

    def aim_and_shoot(self, target_x: int, target_y: int):
        """
        Aim at a target and shoot (for ranged weapons).

        Args:
            target_x: Target X coordinate
            target_y: Target Y coordinate
        """
        self.move_mouse(target_x, target_y, duration=0.05)
        time.sleep(0.02)
        self.click(target_x, target_y, MouseButton.LEFT)

    def continuous_attack(self, x: int, y: int, duration: float = 1.0):
        """
        Continuously attack at a position.

        Args:
            x: X coordinate
            y: Y coordinate
            duration: Total attack duration
        """
        end_time = time.time() + duration
        while time.time() < end_time:
            self.attack(x, y, 0.05)
            time.sleep(0.02)

    # Building actions

    def place_block(self, x: int, y: int):
        """
        Place a block at position.

        Args:
            x: X coordinate
            y: Y coordinate
        """
        self.click(x, y, MouseButton.LEFT)

    def place_blocks_line(self, start: Tuple[int, int], end: Tuple[int, int],
                          interval: float = 0.05):
        """
        Place blocks in a line.

        Args:
            start: Starting position
            end: Ending position
            interval: Time between placements
        """
        # Calculate direction
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        distance = max(abs(dx), abs(dy))

        if distance == 0:
            self.place_block(start[0], start[1])
            return

        step_x = dx / distance
        step_y = dy / distance

        # Hold mouse button and drag
        pyautogui.moveTo(start[0], start[1])
        pyautogui.mouseDown(button='left')

        for i in range(int(distance) + 1):
            x = int(start[0] + step_x * i)
            y = int(start[1] + step_y * i)
            pyautogui.moveTo(x, y)
            time.sleep(interval)

        pyautogui.mouseUp(button='left')

    def mine_block(self, x: int, y: int, duration: float = 0.5):
        """
        Mine a block at position.

        Args:
            x: X coordinate
            y: Y coordinate
            duration: How long to mine (depends on pickaxe power)
        """
        self.hold_click(x, y, MouseButton.LEFT, duration)

    def cleanup(self):
        """Clean up by releasing all held keys."""
        self.release_all_keys()

    def __del__(self):
        """Destructor to ensure keys are released."""
        self.cleanup()
