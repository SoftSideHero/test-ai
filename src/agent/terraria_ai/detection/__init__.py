"""
Detection modules for Terraria AI Agent.
"""

from .entities import EntityDetector
from .blocks import BlockDetector
from .ui import UIDetector

__all__ = [
    "EntityDetector",
    "BlockDetector",
    "UIDetector",
]
