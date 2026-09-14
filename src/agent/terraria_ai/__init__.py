"""
Terraria AI Agent
=================

An AI system that plays Terraria autonomously, capable of:
- Building NPC houses
- Mining blocks (stone, dirt, ores)
- Combat against zombies and Eye of Cthulhu
- World navigation
- Inventory management
"""

__version__ = "1.0.0"
__author__ = "Terraria AI Agent"

from .ai_agent import TerrariaAI
from .game_state import GameState
from .vision import Vision
from .input_controller import InputController

__all__ = ["TerrariaAI", "GameState", "Vision", "InputController"]
