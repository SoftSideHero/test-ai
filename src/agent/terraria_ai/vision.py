"""
Vision system for Terraria AI Agent.
Handles screen capture and image processing.
"""

import numpy as np
import cv2
from PIL import Image
import mss
from typing import Optional, Tuple, List, Dict
from dataclasses import dataclass
import time

from .config import config


@dataclass
class DetectedObject:
    """Represents a detected object in the game."""
    name: str
    x: int
    y: int
    width: int
    height: int
    confidence: float
    category: str  # 'enemy', 'block', 'item', 'npc', 'ui'

    @property
    def center(self) -> Tuple[int, int]:
        return (self.x + self.width // 2, self.y + self.height // 2)

    @property
    def bounds(self) -> Tuple[int, int, int, int]:
        return (self.x, self.y, self.x + self.width, self.y + self.height)


class Vision:
    """
    Vision system for capturing and analyzing game screen.
    """

    def __init__(self):
        self.sct = mss.mss()
        self.screen_width = config.screen.width
        self.screen_height = config.screen.height
        self.last_frame = None
        self.last_capture_time = 0

        # Template cache for object detection
        self.templates: Dict[str, np.ndarray] = {}

        # Color ranges for detection (HSV)
        self.color_ranges = {
            'zombie': {
                'lower': np.array([0, 20, 40]),
                'upper': np.array([20, 100, 120])
            },
            'blue_slime': {
                'lower': np.array([80, 100, 100]),
                'upper': np.array([100, 255, 255])
            },
            'skeleton': {
                'lower': np.array([100, 80, 80]),   # Blue shirt color
                'upper': np.array([130, 255, 200])
            },
            'eye_of_cthulhu': {
                'lower': np.array([0, 100, 150]),
                'upper': np.array([10, 255, 255])
            },
            'health_bar': {
                'lower': np.array([0, 200, 200]),
                'upper': np.array([10, 255, 255])
            },
            'mana_bar': {
                'lower': np.array([100, 200, 200]),
                'upper': np.array([130, 255, 255])
            },
            'dirt': {
                'lower': np.array([10, 50, 50]),
                'upper': np.array([25, 150, 160])
            },
            'stone': {
                'lower': np.array([0, 0, 100]),
                'upper': np.array([180, 30, 160])
            },
            'wood': {
                'lower': np.array([15, 80, 100]),
                'upper': np.array([30, 180, 200])
            },
            'player': {
                'lower': np.array([0, 0, 200]),
                'upper': np.array([180, 50, 255])
            }
        }

    def capture_screen(self, region: Optional[Tuple[int, int, int, int]] = None) -> np.ndarray:
        """
        Capture the game screen.

        Args:
            region: Optional (x, y, width, height) tuple for partial capture

        Returns:
            numpy array of the captured image in BGR format
        """
        if region:
            monitor = {
                "left": region[0],
                "top": region[1],
                "width": region[2],
                "height": region[3]
            }
        else:
            monitor = self.sct.monitors[1]  # Primary monitor

        screenshot = self.sct.grab(monitor)
        frame = np.array(screenshot)

        # Convert from BGRA to BGR
        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)

        self.last_frame = frame
        self.last_capture_time = time.time()

        return frame

    def get_frame(self) -> np.ndarray:
        """Get the current frame, capturing if necessary."""
        if self.last_frame is None:
            return self.capture_screen()
        return self.last_frame

    def find_player_position(self, frame: np.ndarray = None) -> Optional[Tuple[int, int]]:
        """
        Find the player position on screen.
        In Terraria, the player is typically centered on the screen.

        Returns:
            (x, y) tuple of player center position, or None if not found
        """
        if frame is None:
            frame = self.get_frame()

        # Player is typically at screen center in Terraria
        # We can refine this by looking for the character sprite
        center_x = frame.shape[1] // 2
        center_y = frame.shape[0] // 2

        return (center_x, center_y)

    def find_enemies(self, frame: np.ndarray = None) -> List[DetectedObject]:
        """
        Detect enemies in the current frame.

        Returns:
            List of DetectedObject for each enemy found
        """
        if frame is None:
            frame = self.get_frame()

        enemies = []

        # Convert to HSV for color-based detection
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Detect zombies (green-ish humanoid shapes)
        zombie_mask = cv2.inRange(hsv,
                                   self.color_ranges['zombie']['lower'],
                                   self.color_ranges['zombie']['upper'])
        zombie_contours, _ = cv2.findContours(zombie_mask, cv2.RETR_EXTERNAL,
                                               cv2.CHAIN_APPROX_SIMPLE)

        for contour in zombie_contours:
            area = cv2.contourArea(contour)
            if 500 < area < 10000:  # Filter by size
                x, y, w, h = cv2.boundingRect(contour)
                aspect_ratio = h / w if w > 0 else 0

                # Zombies are taller than wide
                if 1.5 < aspect_ratio < 4:
                    enemies.append(DetectedObject(
                        name='zombie',
                        x=x, y=y, width=w, height=h,
                        confidence=min(area / 5000, 1.0),
                        category='enemy'
                    ))

        # Detect Eye of Cthulhu (large red/white circular shape)
        eye_mask = cv2.inRange(hsv,
                               self.color_ranges['eye_of_cthulhu']['lower'],
                               self.color_ranges['eye_of_cthulhu']['upper'])
        eye_contours, _ = cv2.findContours(eye_mask, cv2.RETR_EXTERNAL,
                                           cv2.CHAIN_APPROX_SIMPLE)

        for contour in eye_contours:
            area = cv2.contourArea(contour)
            if area > 5000:  # Eye of Cthulhu is large
                x, y, w, h = cv2.boundingRect(contour)
                circularity = 4 * np.pi * area / (cv2.arcLength(contour, True) ** 2) if cv2.arcLength(contour, True) > 0 else 0

                # Eyes are somewhat circular
                if circularity > 0.5:
                    enemies.append(DetectedObject(
                        name='eye_of_cthulhu',
                        x=x, y=y, width=w, height=h,
                        confidence=min(circularity, 1.0),
                        category='enemy'
                    ))

        # Detect blue slimes (cyan/blue blob shapes)
        blue_slime_mask = cv2.inRange(hsv,
                                      self.color_ranges['blue_slime']['lower'],
                                      self.color_ranges['blue_slime']['upper'])
        blue_slime_contours, _ = cv2.findContours(blue_slime_mask, cv2.RETR_EXTERNAL,
                                                   cv2.CHAIN_APPROX_SIMPLE)

        for contour in blue_slime_contours:
            area = cv2.contourArea(contour)
            if 200 < area < 5000:  # Blue slimes can be slightly bigger
                x, y, w, h = cv2.boundingRect(contour)
                aspect_ratio = h / w if w > 0 else 0

                # Slimes are roughly blob-shaped
                if 0.5 < aspect_ratio < 1.8:
                    enemies.append(DetectedObject(
                        name='blue_slime',
                        x=x, y=y, width=w, height=h,
                        confidence=min(area / 2500, 1.0),
                        category='enemy'
                    ))

        # Detect skeletons (blue shirt, tall humanoid shape)
        skeleton_mask = cv2.inRange(hsv,
                                    self.color_ranges['skeleton']['lower'],
                                    self.color_ranges['skeleton']['upper'])
        skeleton_contours, _ = cv2.findContours(skeleton_mask, cv2.RETR_EXTERNAL,
                                                 cv2.CHAIN_APPROX_SIMPLE)

        for contour in skeleton_contours:
            area = cv2.contourArea(contour)
            if 300 < area < 8000:  # Skeletons are medium-sized
                x, y, w, h = cv2.boundingRect(contour)
                aspect_ratio = h / w if w > 0 else 0

                # Skeletons are taller than wide (humanoid shape)
                if 1.2 < aspect_ratio < 4.0:
                    # Skip very large areas (background)
                    if w > 120 or h > 200:
                        continue

                    enemies.append(DetectedObject(
                        name='skeleton',
                        x=x, y=y, width=w, height=h,
                        confidence=min(area / 4000, 1.0),
                        category='enemy'
                    ))

        return enemies

    def find_blocks(self, frame: np.ndarray = None, block_type: str = 'stone') -> List[DetectedObject]:
        """
        Detect blocks of a specific type.

        Args:
            frame: Image to analyze
            block_type: Type of block to find ('stone', 'dirt', 'wood')

        Returns:
            List of DetectedObject for blocks found
        """
        if frame is None:
            frame = self.get_frame()

        blocks = []

        if block_type not in self.color_ranges:
            return blocks

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                          self.color_ranges[block_type]['lower'],
                          self.color_ranges[block_type]['upper'])

        # Apply morphological operations to clean up
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)

        block_size = config.game.block_size

        for contour in contours:
            area = cv2.contourArea(contour)
            if area > block_size * block_size * 0.5:  # At least half a block
                x, y, w, h = cv2.boundingRect(contour)
                blocks.append(DetectedObject(
                    name=block_type,
                    x=x, y=y, width=w, height=h,
                    confidence=min(area / (block_size * block_size * 4), 1.0),
                    category='block'
                ))

        return blocks

    def get_health_percentage(self, frame: np.ndarray = None) -> float:
        """
        Get player health percentage from UI.

        Returns:
            Health percentage (0.0 to 1.0)
        """
        if frame is None:
            frame = self.get_frame()

        # Health bar region (top right in Terraria)
        health_x, health_y = config.game.health_bar_pos
        health_region = frame[health_y:health_y+20, health_x-200:health_x]

        if health_region.size == 0:
            return 1.0

        hsv = cv2.cvtColor(health_region, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                          self.color_ranges['health_bar']['lower'],
                          self.color_ranges['health_bar']['upper'])

        # Calculate percentage based on red pixels
        red_pixels = cv2.countNonZero(mask)
        total_pixels = mask.shape[0] * mask.shape[1]

        return red_pixels / total_pixels if total_pixels > 0 else 1.0

    def get_mana_percentage(self, frame: np.ndarray = None) -> float:
        """
        Get player mana percentage from UI.

        Returns:
            Mana percentage (0.0 to 1.0)
        """
        if frame is None:
            frame = self.get_frame()

        mana_x, mana_y = config.game.mana_bar_pos
        mana_region = frame[mana_y:mana_y+20, mana_x-200:mana_x]

        if mana_region.size == 0:
            return 1.0

        hsv = cv2.cvtColor(mana_region, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                          self.color_ranges['mana_bar']['lower'],
                          self.color_ranges['mana_bar']['upper'])

        blue_pixels = cv2.countNonZero(mask)
        total_pixels = mask.shape[0] * mask.shape[1]

        return blue_pixels / total_pixels if total_pixels > 0 else 1.0

    def is_inventory_open(self, frame: np.ndarray = None) -> bool:
        """
        Check if the inventory screen is currently open.

        Returns:
            True if inventory is open
        """
        if frame is None:
            frame = self.get_frame()

        # Check for inventory UI elements
        # Inventory has a distinct dark background with item slots
        inv_x, inv_y = config.game.inventory_start

        # Check a region where inventory would be
        region = frame[inv_y:inv_y+400, inv_x:inv_x+500]

        if region.size == 0:
            return False

        # Inventory has a specific dark gray background
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        dark_pixels = np.sum(gray < 60)
        total_pixels = gray.size

        # If more than 30% is dark, inventory is likely open
        return dark_pixels / total_pixels > 0.3

    def find_cursor_position(self) -> Tuple[int, int]:
        """
        Get current cursor position on screen.

        Returns:
            (x, y) tuple of cursor position
        """
        import pyautogui
        return pyautogui.position()

    def detect_night_time(self, frame: np.ndarray = None) -> bool:
        """
        Detect if it's night time in the game (when zombies spawn).

        Returns:
            True if it appears to be night time
        """
        if frame is None:
            frame = self.get_frame()

        # Sample the sky region (top of screen, excluding UI)
        sky_region = frame[50:150, 100:frame.shape[1]-200]

        if sky_region.size == 0:
            return False

        # Night sky is darker
        avg_brightness = np.mean(sky_region)

        return avg_brightness < 80  # Dark sky indicates night

    def find_suitable_building_area(self, frame: np.ndarray = None) -> Optional[Tuple[int, int]]:
        """
        Find a flat area suitable for building an NPC house.

        Returns:
            (x, y) position for building, or None if not found
        """
        if frame is None:
            frame = self.get_frame()

        # Look for flat ground near player (center of screen)
        center_x = frame.shape[1] // 2
        center_y = frame.shape[0] // 2

        # Convert to grayscale for edge detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Find horizontal edges (ground surface)
        edges = cv2.Canny(gray, 50, 150)

        # Look for flat horizontal lines in the lower half of screen
        search_region = edges[center_y:, :]

        lines = cv2.HoughLinesP(search_region, 1, np.pi/180, 50,
                                minLineLength=100, maxLineGap=10)

        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                # Check if line is mostly horizontal
                if abs(y2 - y1) < 10:
                    # Return the center of the flat area
                    return ((x1 + x2) // 2, y1 + center_y - 50)

        # Default to area below player center
        return (center_x, center_y + 100)

    def visualize_detections(self, frame: np.ndarray,
                            objects: List[DetectedObject]) -> np.ndarray:
        """
        Draw detection boxes on frame for debugging.

        Args:
            frame: Image to draw on
            objects: List of detected objects

        Returns:
            Frame with drawn detections
        """
        result = frame.copy()

        colors = {
            'enemy': (0, 0, 255),    # Red
            'block': (0, 255, 0),    # Green
            'item': (255, 255, 0),   # Cyan
            'npc': (255, 0, 255),    # Magenta
            'ui': (255, 255, 255),   # White
        }

        for obj in objects:
            color = colors.get(obj.category, (128, 128, 128))
            cv2.rectangle(result, (obj.x, obj.y),
                         (obj.x + obj.width, obj.y + obj.height),
                         color, 2)
            cv2.putText(result, f"{obj.name} ({obj.confidence:.2f})",
                       (obj.x, obj.y - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)

        return result

    def save_debug_frame(self, frame: np.ndarray, filename: str = "debug_frame.png"):
        """Save frame for debugging."""
        cv2.imwrite(filename, frame)

    def cleanup(self):
        """Clean up resources."""
        self.sct.close()
