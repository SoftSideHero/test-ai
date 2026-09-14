"""
Movement controller for Terraria AI Agent.
Handles player navigation and pathfinding.
"""

import time
from typing import Tuple, Optional, List
from enum import Enum, auto

from ..input_controller import InputController
from ..game_state import GameState
from ..config import config


class Direction(Enum):
    """Movement directions."""
    LEFT = auto()
    RIGHT = auto()
    UP = auto()
    DOWN = auto()


class MovementController:
    """
    Controls player movement and navigation.
    """

    def __init__(self, input_controller: InputController, game_state: GameState):
        self.input = input_controller
        self.state = game_state

        # Movement state
        self.is_moving = False
        self.current_direction: Optional[Direction] = None
        self.target_position: Optional[Tuple[int, int]] = None

        # Navigation history
        self.position_history: List[Tuple[int, int]] = []
        self.stuck_threshold = 5  # frames without significant movement

    def move_to_position(self, target_x: int, target_y: int,
                         tolerance: int = 20) -> bool:
        """
        Move toward a target position on screen.

        Args:
            target_x: Target X coordinate
            target_y: Target Y coordinate
            tolerance: How close to get before stopping

        Returns:
            True if reached target, False otherwise
        """
        self.target_position = (target_x, target_y)

        current_x, current_y = self.state.player.position

        dx = target_x - current_x
        dy = target_y - current_y

        distance = (dx ** 2 + dy ** 2) ** 0.5

        # Check if we've reached the target
        if distance < tolerance:
            self.stop()
            return True

        # Determine movement direction
        if abs(dx) > tolerance:
            if dx > 0:
                self.move_right()
            else:
                self.move_left()

        # Handle vertical movement (jumping)
        if dy < -tolerance:  # Target is above
            self.jump()
        elif dy > tolerance * 3:  # Target is far below
            # Just fall or use rope/platform
            pass

        return False

    def move_left(self, duration: float = None):
        """Move left."""
        self.current_direction = Direction.LEFT
        self.is_moving = True

        if duration:
            self.input.move_left(duration)
        else:
            self.input.start_moving_left()

    def move_right(self, duration: float = None):
        """Move right."""
        self.current_direction = Direction.RIGHT
        self.is_moving = True

        if duration:
            self.input.move_right(duration)
        else:
            self.input.start_moving_right()

    def stop(self):
        """Stop all movement."""
        self.input.stop_moving()
        self.is_moving = False
        self.current_direction = None

    def jump(self, hold_duration: float = 0.15):
        """
        Make the player jump.

        Args:
            hold_duration: How long to hold jump (affects height)
        """
        self.input.jump(hold_duration)

    def double_jump(self):
        """Perform a double jump (if player has double jump accessory)."""
        self.input.jump(0.15)
        time.sleep(0.3)
        self.input.jump(0.15)

    def jump_and_move(self, direction: Direction, jump_duration: float = 0.15):
        """
        Jump while moving in a direction.

        Args:
            direction: Direction to move
            jump_duration: Jump hold duration
        """
        if direction == Direction.LEFT:
            self.input.hold_key(self.input.keys.move_left)
        else:
            self.input.hold_key(self.input.keys.move_right)

        self.input.jump(jump_duration)
        time.sleep(0.1)

        if direction == Direction.LEFT:
            self.input.release_key(self.input.keys.move_left)
        else:
            self.input.release_key(self.input.keys.move_right)

    def grapple_to(self, x: int, y: int):
        """
        Use grappling hook to reach a position.

        Args:
            x: Target X coordinate
            y: Target Y coordinate
        """
        self.input.move_mouse(x, y, duration=0.05)
        self.input.grapple()

    def explore_direction(self, direction: Direction, duration: float = 2.0):
        """
        Explore in a direction for a set duration.

        Args:
            direction: Direction to explore
            duration: How long to move
        """
        start_time = time.time()

        if direction == Direction.LEFT:
            self.input.start_moving_left()
        elif direction == Direction.RIGHT:
            self.input.start_moving_right()

        while time.time() - start_time < duration:
            # Jump occasionally to get over obstacles
            if time.time() % 1 < 0.1:
                self.input.jump(0.1)
            time.sleep(0.1)

        self.stop()

    def flee_from_position(self, danger_x: int, danger_y: int):
        """
        Flee away from a dangerous position.

        Args:
            danger_x: X coordinate of danger
            danger_y: Y coordinate of danger
        """
        current_x, current_y = self.state.player.position

        # Move away from danger
        if danger_x > current_x:
            self.move_left(0.2)
        else:
            self.move_right(0.2)

        # Jump to evade if danger is close
        if abs(danger_x - current_x) < 100:
            self.jump(0.2)

    def is_stuck(self) -> bool:
        """
        Check if the player appears to be stuck.

        Returns:
            True if player hasn't moved significantly
        """
        if len(self.position_history) < self.stuck_threshold:
            return False

        recent = self.position_history[-self.stuck_threshold:]

        # Calculate total movement
        total_movement = 0
        for i in range(1, len(recent)):
            dx = recent[i][0] - recent[i-1][0]
            dy = recent[i][1] - recent[i-1][1]
            total_movement += (dx ** 2 + dy ** 2) ** 0.5

        # If total movement is very small, we're stuck
        return total_movement < 10

    def unstick(self):
        """Attempt to get unstuck by jumping and moving."""
        # Try jumping
        self.jump(0.3)
        time.sleep(0.2)

        # Try moving in opposite direction
        if self.current_direction == Direction.LEFT:
            self.move_right(0.3)
        else:
            self.move_left(0.3)

        # Jump again
        self.jump(0.3)

    def patrol(self, left_bound: int, right_bound: int, duration: float = 10.0):
        """
        Patrol between two horizontal positions.

        Args:
            left_bound: Left boundary
            right_bound: Right boundary
            duration: Total patrol duration
        """
        start_time = time.time()
        going_right = True

        while time.time() - start_time < duration:
            current_x, _ = self.state.player.position

            if going_right:
                if current_x >= right_bound:
                    going_right = False
                    self.move_left(0.5)
                else:
                    self.move_right(0.1)
            else:
                if current_x <= left_bound:
                    going_right = True
                    self.move_right(0.5)
                else:
                    self.move_left(0.1)

            time.sleep(0.05)

        self.stop()

    def update_position_history(self):
        """Update the position history."""
        self.position_history.append(self.state.player.position)

        # Limit history size
        if len(self.position_history) > 50:
            self.position_history.pop(0)

    def get_distance_to(self, x: int, y: int) -> float:
        """Calculate distance to a position."""
        current_x, current_y = self.state.player.position
        return ((x - current_x) ** 2 + (y - current_y) ** 2) ** 0.5

    def cleanup(self):
        """Clean up movement state."""
        self.stop()
        self.target_position = None
