"""
Block detection for Terraria AI Agent.
Detects various block types for mining and building.
"""

import numpy as np
import cv2
from typing import List, Dict, Tuple
from dataclasses import dataclass

from ..vision import DetectedObject
from ..config import config


@dataclass
class BlockProfile:
    """Profile for detecting a specific block type."""
    name: str
    color_lower: np.ndarray
    color_upper: np.ndarray
    min_area: int


class BlockDetector:
    """
    Detects blocks in game frames.
    """

    def __init__(self):
        self.block_size = config.game.block_size

        # Block profiles for detection
        self.profiles: Dict[str, BlockProfile] = {
            'dirt': BlockProfile(
                name='dirt',
                color_lower=np.array([10, 50, 50]),
                color_upper=np.array([25, 150, 160]),
                min_area=100
            ),
            'stone': BlockProfile(
                name='stone',
                color_lower=np.array([0, 0, 80]),
                color_upper=np.array([180, 30, 150]),
                min_area=100
            ),
            'wood': BlockProfile(
                name='wood',
                color_lower=np.array([15, 80, 100]),
                color_upper=np.array([30, 180, 200]),
                min_area=80
            ),
            'grass': BlockProfile(
                name='grass',
                color_lower=np.array([35, 80, 50]),
                color_upper=np.array([85, 255, 200]),
                min_area=100
            ),
            'sand': BlockProfile(
                name='sand',
                color_lower=np.array([20, 80, 180]),
                color_upper=np.array([35, 180, 255]),
                min_area=100
            ),
            'copper_ore': BlockProfile(
                name='copper_ore',
                color_lower=np.array([10, 150, 100]),
                color_upper=np.array([25, 255, 200]),
                min_area=50
            ),
            'iron_ore': BlockProfile(
                name='iron_ore',
                color_lower=np.array([0, 0, 120]),
                color_upper=np.array([180, 40, 180]),
                min_area=50
            ),
            'silver_ore': BlockProfile(
                name='silver_ore',
                color_lower=np.array([0, 0, 180]),
                color_upper=np.array([180, 30, 255]),
                min_area=50
            ),
            'gold_ore': BlockProfile(
                name='gold_ore',
                color_lower=np.array([20, 180, 180]),
                color_upper=np.array([35, 255, 255]),
                min_area=50
            ),
        }

    def detect_all(self, frame: np.ndarray) -> List[DetectedObject]:
        """
        Detect all block types in a frame.

        Args:
            frame: BGR image frame

        Returns:
            List of detected blocks
        """
        blocks = []

        for name, profile in self.profiles.items():
            detected = self._detect_block_type(frame, profile)
            blocks.extend(detected)

        return blocks

    def detect_minable(self, frame: np.ndarray) -> List[DetectedObject]:
        """
        Detect blocks that can be mined (stone, dirt, ores).

        Args:
            frame: BGR image frame

        Returns:
            List of minable blocks
        """
        minable_types = ['stone', 'dirt', 'copper_ore', 'iron_ore',
                        'silver_ore', 'gold_ore']
        blocks = []

        for block_type in minable_types:
            if block_type in self.profiles:
                detected = self._detect_block_type(frame,
                                                   self.profiles[block_type])
                blocks.extend(detected)

        return blocks

    def detect_ores(self, frame: np.ndarray) -> List[DetectedObject]:
        """
        Detect ore blocks specifically.

        Args:
            frame: BGR image frame

        Returns:
            List of detected ore blocks
        """
        ore_types = ['copper_ore', 'iron_ore', 'silver_ore', 'gold_ore']
        ores = []

        for ore_type in ore_types:
            if ore_type in self.profiles:
                detected = self._detect_block_type(frame,
                                                   self.profiles[ore_type])
                ores.extend(detected)

        return ores

    def detect_specific(self, frame: np.ndarray,
                        block_type: str) -> List[DetectedObject]:
        """
        Detect a specific block type.

        Args:
            frame: BGR image frame
            block_type: Type of block to detect

        Returns:
            List of detected blocks
        """
        if block_type not in self.profiles:
            return []

        return self._detect_block_type(frame, self.profiles[block_type])

    def _detect_block_type(self, frame: np.ndarray,
                           profile: BlockProfile) -> List[DetectedObject]:
        """
        Detect blocks matching a specific profile.

        Args:
            frame: BGR image frame
            profile: Block profile to match

        Returns:
            List of detected blocks
        """
        blocks = []

        # Convert to HSV
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Create mask
        mask = cv2.inRange(hsv, profile.color_lower, profile.color_upper)

        # Clean up mask
        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)

        for contour in contours:
            area = cv2.contourArea(contour)

            if area < profile.min_area:
                continue

            x, y, w, h = cv2.boundingRect(contour)

            # Estimate number of blocks in this region
            num_blocks = area / (self.block_size * self.block_size)
            confidence = min(num_blocks / 4, 1.0)

            blocks.append(DetectedObject(
                name=profile.name,
                x=x, y=y, width=w, height=h,
                confidence=confidence,
                category='block'
            ))

        return blocks

    def find_surface(self, frame: np.ndarray) -> List[Tuple[int, int]]:
        """
        Find the surface level (top of ground).

        Args:
            frame: BGR image frame

        Returns:
            List of (x, y) points representing surface
        """
        # Detect grass and dirt (surface blocks)
        surface_blocks = []

        for block_type in ['grass', 'dirt']:
            if block_type in self.profiles:
                blocks = self._detect_block_type(frame,
                                                 self.profiles[block_type])
                surface_blocks.extend(blocks)

        if not surface_blocks:
            return []

        # Find topmost y for each x region
        surface_points = []
        x_regions = {}

        for block in surface_blocks:
            region_x = block.x // 50  # Group by 50 pixel regions
            if region_x not in x_regions or block.y < x_regions[region_x]:
                x_regions[region_x] = block.y

        for region_x, y in sorted(x_regions.items()):
            surface_points.append((region_x * 50 + 25, y))

        return surface_points

    def add_profile(self, profile: BlockProfile):
        """Add a custom block profile."""
        self.profiles[profile.name] = profile
