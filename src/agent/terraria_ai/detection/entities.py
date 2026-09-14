"""
Entity detection for Terraria AI Agent.
Detects enemies, NPCs, and other entities.
"""

import numpy as np
import cv2
from typing import List, Dict, Tuple
from dataclasses import dataclass

from ..vision import DetectedObject


@dataclass
class EntityProfile:
    """Profile for detecting a specific entity type."""
    name: str
    color_lower: np.ndarray
    color_upper: np.ndarray
    min_area: int
    max_area: int
    aspect_ratio_range: Tuple[float, float]
    category: str


class EntityDetector:
    """
    Detects entities (enemies, NPCs, etc.) in game frames.
    """

    def __init__(self):
        # Entity profiles for detection
        self.profiles: Dict[str, EntityProfile] = {
            'zombie': EntityProfile(
                name='zombie',
                color_lower=np.array([0, 20, 40]),
                color_upper=np.array([20, 100, 120]),
                min_area=500,
                max_area=10000,
                aspect_ratio_range=(1.5, 4.0),
                category='enemy'
            ),
            'demon_eye': EntityProfile(
                name='demon_eye',
                color_lower=np.array([0, 100, 100]),
                color_upper=np.array([15, 255, 255]),
                min_area=200,
                max_area=3000,
                aspect_ratio_range=(0.7, 1.5),
                category='enemy'
            ),
            'eye_of_cthulhu': EntityProfile(
                name='eye_of_cthulhu',
                color_lower=np.array([0, 80, 150]),
                color_upper=np.array([15, 255, 255]),
                min_area=5000,
                max_area=50000,
                aspect_ratio_range=(0.5, 2.0),
                category='boss'
            ),
            'blue_slime': EntityProfile(
                name='blue_slime',
                color_lower=np.array([80, 100, 100]),
                color_upper=np.array([100, 255, 255]),
                min_area=300,
                max_area=5000,
                aspect_ratio_range=(0.8, 1.5),
                category='enemy'
            ),
            'skeleton': EntityProfile(
                name='skeleton',
                color_lower=np.array([100, 80, 80]),   # Blue shirt color
                color_upper=np.array([130, 255, 200]),
                min_area=300,
                max_area=8000,
                aspect_ratio_range=(1.2, 4.0),  # Tall humanoid shape
                category='enemy'
            ),
            'guide_npc': EntityProfile(
                name='guide',
                color_lower=np.array([15, 50, 100]),
                color_upper=np.array([30, 150, 200]),
                min_area=400,
                max_area=8000,
                aspect_ratio_range=(1.5, 3.5),
                category='npc'
            ),
        }

    def detect_all(self, frame: np.ndarray) -> List[DetectedObject]:
        """
        Detect all entities in a frame.

        Args:
            frame: BGR image frame

        Returns:
            List of detected entities
        """
        entities = []

        for name, profile in self.profiles.items():
            detected = self._detect_entity_type(frame, profile)
            entities.extend(detected)

        return entities

    def detect_enemies(self, frame: np.ndarray) -> List[DetectedObject]:
        """
        Detect only enemy entities.

        Args:
            frame: BGR image frame

        Returns:
            List of detected enemies
        """
        enemies = []

        for name, profile in self.profiles.items():
            if profile.category in ['enemy', 'boss']:
                detected = self._detect_entity_type(frame, profile)
                enemies.extend(detected)

        return enemies

    def detect_specific(self, frame: np.ndarray, entity_name: str) -> List[DetectedObject]:
        """
        Detect a specific entity type.

        Args:
            frame: BGR image frame
            entity_name: Name of entity to detect

        Returns:
            List of detected entities
        """
        if entity_name not in self.profiles:
            return []

        return self._detect_entity_type(frame, self.profiles[entity_name])

    def _detect_entity_type(self, frame: np.ndarray,
                            profile: EntityProfile) -> List[DetectedObject]:
        """
        Detect entities matching a specific profile.

        Args:
            frame: BGR image frame
            profile: Entity profile to match

        Returns:
            List of detected entities
        """
        entities = []

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

            # Check area bounds
            if not (profile.min_area < area < profile.max_area):
                continue

            x, y, w, h = cv2.boundingRect(contour)

            # Check aspect ratio
            aspect_ratio = h / w if w > 0 else 0
            if not (profile.aspect_ratio_range[0] < aspect_ratio <
                   profile.aspect_ratio_range[1]):
                continue

            # Calculate confidence based on how well it matches
            confidence = min(area / (profile.max_area * 0.5), 1.0)

            entities.append(DetectedObject(
                name=profile.name,
                x=x, y=y, width=w, height=h,
                confidence=confidence,
                category=profile.category
            ))

        return entities

    def add_profile(self, profile: EntityProfile):
        """Add a custom entity profile."""
        self.profiles[profile.name] = profile

    def remove_profile(self, name: str):
        """Remove an entity profile."""
        if name in self.profiles:
            del self.profiles[name]
