"""
UI detection for Terraria AI Agent.
Detects UI elements like health bars, inventory, etc.
"""

import numpy as np
import cv2
from typing import Optional, Tuple, List
from dataclasses import dataclass

from ..config import config


@dataclass
class UIElement:
    """Represents a detected UI element."""
    name: str
    x: int
    y: int
    width: int
    height: int
    value: float = 0.0  # For bars, percentage filled


class UIDetector:
    """
    Detects UI elements in game frames.
    """

    def __init__(self):
        self.config = config.game

        # UI color definitions (HSV)
        self.health_color = {
            'lower': np.array([0, 200, 200]),
            'upper': np.array([10, 255, 255])
        }
        self.mana_color = {
            'lower': np.array([100, 200, 200]),
            'upper': np.array([130, 255, 255])
        }
        self.inventory_bg_color = {
            'lower': np.array([0, 0, 20]),
            'upper': np.array([180, 50, 80])
        }

    def detect_health_bar(self, frame: np.ndarray) -> UIElement:
        """
        Detect the health bar and its fill percentage.

        Args:
            frame: BGR image frame

        Returns:
            UIElement with health bar info
        """
        # Health bar location (top right in Terraria)
        health_x, health_y = self.config.health_bar_pos

        # Define region to search
        region_width = 250
        region_height = 30

        x1 = max(0, health_x - region_width)
        y1 = health_y
        x2 = health_x
        y2 = min(frame.shape[0], health_y + region_height)

        region = frame[y1:y2, x1:x2]

        if region.size == 0:
            return UIElement('health_bar', x1, y1, region_width, region_height, 1.0)

        # Convert to HSV and find red pixels
        hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                          self.health_color['lower'],
                          self.health_color['upper'])

        # Calculate fill percentage
        total_pixels = mask.shape[0] * mask.shape[1]
        red_pixels = cv2.countNonZero(mask)

        fill_percentage = red_pixels / total_pixels if total_pixels > 0 else 1.0

        return UIElement(
            name='health_bar',
            x=x1, y=y1,
            width=region_width,
            height=region_height,
            value=fill_percentage
        )

    def detect_mana_bar(self, frame: np.ndarray) -> UIElement:
        """
        Detect the mana bar and its fill percentage.

        Args:
            frame: BGR image frame

        Returns:
            UIElement with mana bar info
        """
        mana_x, mana_y = self.config.mana_bar_pos

        region_width = 250
        region_height = 30

        x1 = max(0, mana_x - region_width)
        y1 = mana_y
        x2 = mana_x
        y2 = min(frame.shape[0], mana_y + region_height)

        region = frame[y1:y2, x1:x2]

        if region.size == 0:
            return UIElement('mana_bar', x1, y1, region_width, region_height, 1.0)

        hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                          self.mana_color['lower'],
                          self.mana_color['upper'])

        total_pixels = mask.shape[0] * mask.shape[1]
        blue_pixels = cv2.countNonZero(mask)

        fill_percentage = blue_pixels / total_pixels if total_pixels > 0 else 1.0

        return UIElement(
            name='mana_bar',
            x=x1, y=y1,
            width=region_width,
            height=region_height,
            value=fill_percentage
        )

    def is_inventory_open(self, frame: np.ndarray) -> bool:
        """
        Check if the inventory screen is open.

        Args:
            frame: BGR image frame

        Returns:
            True if inventory is open
        """
        inv_x, inv_y = self.config.inventory_start

        # Check a region where inventory would be
        region_width = 500
        region_height = 400

        x1 = inv_x
        y1 = inv_y
        x2 = min(frame.shape[1], inv_x + region_width)
        y2 = min(frame.shape[0], inv_y + region_height)

        region = frame[y1:y2, x1:x2]

        if region.size == 0:
            return False

        # Inventory has dark background
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        dark_pixels = np.sum(gray < 60)
        total_pixels = gray.size

        # If more than 30% is dark, inventory is likely open
        return dark_pixels / total_pixels > 0.3

    def detect_hotbar_selection(self, frame: np.ndarray) -> int:
        """
        Detect which hotbar slot is currently selected.

        Args:
            frame: BGR image frame

        Returns:
            Selected slot number (1-10), or 0 if unable to detect
        """
        hotbar_x, hotbar_y = self.config.hotbar_start
        slot_size = self.config.hotbar_slot_size

        # Selected slot typically has a highlight/border
        # Look for brightness differences around each slot

        max_brightness = 0
        selected_slot = 1

        for i in range(10):
            slot_x = hotbar_x + i * slot_size
            slot_y = hotbar_y

            # Get slot region
            region = frame[slot_y:slot_y+slot_size, slot_x:slot_x+slot_size]

            if region.size == 0:
                continue

            # Check border brightness
            border = region[0:3, :].mean() + region[-3:, :].mean()
            border += region[:, 0:3].mean() + region[:, -3:].mean()

            if border > max_brightness:
                max_brightness = border
                selected_slot = i + 1

        return selected_slot

    def detect_buff_icons(self, frame: np.ndarray) -> List[UIElement]:
        """
        Detect active buff icons.

        Args:
            frame: BGR image frame

        Returns:
            List of detected buff icons
        """
        # Buffs appear below mana bar typically
        buffs = []

        # This would need template matching for specific buffs
        # For now, return empty list as placeholder

        return buffs

    def detect_minimap(self, frame: np.ndarray) -> Optional[UIElement]:
        """
        Detect the minimap location and bounds.

        Args:
            frame: BGR image frame

        Returns:
            UIElement for minimap, or None if not found
        """
        # Minimap is typically top-right corner
        # This is a simplified detection

        minimap_size = 200  # Approximate
        x = frame.shape[1] - minimap_size - 10
        y = 10

        return UIElement(
            name='minimap',
            x=x, y=y,
            width=minimap_size,
            height=minimap_size,
            value=0
        )

    def detect_boss_health_bar(self, frame: np.ndarray) -> Optional[UIElement]:
        """
        Detect boss health bar (appears when fighting bosses).

        Args:
            frame: BGR image frame

        Returns:
            UIElement with boss health info, or None if no boss
        """
        # Boss health bar typically appears at bottom of screen
        bar_height = 30
        y = frame.shape[0] - bar_height - 50
        x = frame.shape[1] // 4
        width = frame.shape[1] // 2

        region = frame[y:y+bar_height, x:x+width]

        if region.size == 0:
            return None

        # Look for the distinctive boss health bar color
        hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)

        # Boss bar is typically green/yellow
        lower = np.array([20, 100, 100])
        upper = np.array([80, 255, 255])
        mask = cv2.inRange(hsv, lower, upper)

        filled_pixels = cv2.countNonZero(mask)
        total_pixels = mask.size

        if filled_pixels / total_pixels > 0.1:  # Some threshold
            fill_percentage = filled_pixels / total_pixels
            return UIElement(
                name='boss_health_bar',
                x=x, y=y,
                width=width,
                height=bar_height,
                value=fill_percentage
            )

        return None

    def get_screen_center(self, frame: np.ndarray) -> Tuple[int, int]:
        """Get the center of the screen (where player typically is)."""
        return (frame.shape[1] // 2, frame.shape[0] // 2)
