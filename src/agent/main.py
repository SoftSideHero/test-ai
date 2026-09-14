#!/usr/bin/env python3
"""
Terraria AI Agent - Main Entry Point

An AI that plays Terraria autonomously, capable of:
- Building NPC houses
- Mining blocks (stone, dirt, ores)
- Fighting zombies and Eye of Cthulhu
- Navigating the world
- Managing inventory

Usage:
    python main.py                    # Run with default settings
    python main.py --mode interactive # Run in interactive mode
    python main.py --mode demo        # Run demo mode
    python main.py --config config.yaml  # Use custom config

Requirements:
    - Terraria running in windowed mode at 1920x1080
    - Python 3.8+
    - Dependencies from requirements.txt

Author: Terraria AI Agent
"""

import argparse
import sys
import time
import signal
import threading
from typing import Optional

from terraria_ai import TerrariaAI
from terraria_ai.ai_agent import AIGoal, AITask


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description='Terraria AI Agent - Autonomous Terraria Player',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python main.py                          # Start the AI
    python main.py --mode interactive       # Interactive command mode
    python main.py --mode build             # Build houses mode
    python main.py --mode mine              # Mining mode
    python main.py --mode combat            # Combat training mode
    python main.py --goal boss              # Fight Eye of Cthulhu
        """
    )

    parser.add_argument(
        '--mode', '-m',
        choices=['auto', 'interactive', 'build', 'mine', 'combat', 'demo', 'test'],
        default='auto',
        help='Operating mode (default: auto)'
    )

    parser.add_argument(
        '--goal', '-g',
        choices=['idle', 'explore', 'gather', 'build', 'mine', 'fight', 'boss'],
        default=None,
        help='Initial goal to pursue'
    )

    parser.add_argument(
        '--config', '-c',
        type=str,
        default=None,
        help='Path to configuration file'
    )

    parser.add_argument(
        '--duration', '-d',
        type=int,
        default=None,
        help='Run duration in seconds (default: indefinite)'
    )

    parser.add_argument(
        '--hotbar',
        type=str,
        default=None,
        help='Hotbar configuration: pickaxe,sword,ranged,building,torch (slot numbers)'
    )

    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging'
    )

    return parser.parse_args()


def setup_signal_handlers(ai: TerrariaAI):
    """Set up signal handlers for graceful shutdown."""
    def signal_handler(sig, frame):
        print("\nShutting down gracefully...")
        ai.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)


def goal_from_string(goal_str: str) -> AIGoal:
    """Convert string to AIGoal enum."""
    mapping = {
        'idle': AIGoal.IDLE,
        'explore': AIGoal.EXPLORE,
        'gather': AIGoal.GATHER_RESOURCES,
        'build': AIGoal.BUILD_HOUSE,
        'mine': AIGoal.MINE,
        'fight': AIGoal.FIGHT,
        'boss': AIGoal.BOSS_FIGHT,
    }
    return mapping.get(goal_str, AIGoal.IDLE)


def test_mode(ai: TerrariaAI):
    """Test mode to verify screen capture and basic functions work."""
    print("""
╔═══════════════════════════════════════════════════════════╗
║              Terraria AI Agent - Test Mode                 ║
╠═══════════════════════════════════════════════════════════╣
║ Testing basic functionality...                             ║
╚═══════════════════════════════════════════════════════════╝
    """)

    print("[1/5] Testing screen capture...")
    try:
        frame = ai.vision.capture_screen()
        print(f"  ✓ Screen captured: {frame.shape[1]}x{frame.shape[0]} pixels")
    except Exception as e:
        print(f"  ✗ Screen capture failed: {e}")
        return

    print("\n[2/5] Testing player detection...")
    try:
        pos = ai.vision.find_player_position(frame)
        print(f"  ✓ Player position: {pos}")
    except Exception as e:
        print(f"  ✗ Player detection failed: {e}")

    print("\n[3/5] Testing health detection...")
    try:
        health = ai.vision.get_health_percentage(frame)
        print(f"  ✓ Health: {health*100:.1f}%")
    except Exception as e:
        print(f"  ✗ Health detection failed: {e}")

    print("\n[4/5] Testing enemy detection...")
    try:
        enemies = ai.vision.find_enemies(frame)
        print(f"  ✓ Enemies found: {len(enemies)}")
    except Exception as e:
        print(f"  ✗ Enemy detection failed: {e}")

    print("\n[5/5] Testing keyboard input...")
    print("  Will press 'W' key in 3 seconds...")
    print("  (Make sure Terraria is focused!)")
    time.sleep(3)
    try:
        ai.input.press_key('w', 0.1)
        print("  ✓ Key press sent")
    except Exception as e:
        print(f"  ✗ Input failed: {e}")

    print("\n" + "="*50)
    print("Test complete! If Terraria responded to the key press,")
    print("the AI should be working. Try 'python main.py --mode interactive'")

    # Save debug screenshot
    try:
        ai.vision.save_debug_frame(frame, "debug_screenshot.png")
        print("\nDebug screenshot saved to: debug_screenshot.png")
    except:
        pass


def countdown(seconds: int = 2):
    """Display a countdown before executing an action."""
    print(f"Starting in {seconds}... (switch to Terraria now!)")
    for i in range(seconds, 0, -1):
        print(f"  {i}...")
        time.sleep(1)
    print("  Go!")


def interactive_mode(ai: TerrariaAI):
    """Run in interactive command mode with background AI loop."""
    print("""
╔═══════════════════════════════════════════════════════════╗
║           Terraria AI Agent - Interactive Mode             ║
╠═══════════════════════════════════════════════════════════╣
║ Commands:                                                  ║
║   build     - Build an NPC house                          ║
║   mine      - Mine blocks for 30 seconds                  ║
║   fight     - Fight enemies for 30 seconds                ║
║   explore   - Explore for 30 seconds                      ║
║   boss      - Fight Eye of Cthulhu (night only)           ║
║   left/right- Move left or right                          ║
║   jump      - Jump                                        ║
║   slot 1-10 - Select hotbar slot                          ║
║   click     - Click at screen center                      ║
║   status    - Show current status                         ║
║   test      - Test screen capture                         ║
║   quit      - Exit the program                            ║
╚═══════════════════════════════════════════════════════════╝

You have 2 seconds to switch to Terraria after each command!
    """)

    while True:
        try:
            cmd = input("\n> ").strip().lower()

            if cmd == 'quit' or cmd == 'exit':
                break

            elif cmd == 'test':
                print("Testing screen capture...")
                countdown(2)
                frame = ai.vision.capture_screen()
                print(f"Captured: {frame.shape[1]}x{frame.shape[0]}")
                health = ai.vision.get_health_percentage(frame)
                print(f"Health detected: {health*100:.1f}%")
                enemies = ai.vision.find_enemies(frame)
                print(f"Enemies detected: {len(enemies)}")
                ai.vision.save_debug_frame(frame, "debug_screenshot.png")
                print("Screenshot saved to debug_screenshot.png")

            elif cmd == 'build':
                print("Building NPC house... (this takes about 30 seconds)")
                print("Make sure you have blocks in slot 4, walls in slot 5, etc.")
                countdown(2)
                ai.building.build_npc_house()
                print("Build attempt complete!")

            elif cmd == 'mine':
                print("Mining for 30 seconds...")
                print("Make sure pickaxe is in slot 1!")
                countdown(2)
                ai.inventory.select_pickaxe()
                start = time.time()
                while time.time() - start < 30:
                    ai.mining.mine_below(0.5)
                    time.sleep(0.2)
                    print(f"Mining... {30 - int(time.time() - start)}s left", end='\r')
                print("\nMining complete!")

            elif cmd == 'fight':
                print("Fighting for 30 seconds...")
                countdown(2)
                ai.inventory.select_weapon()
                start = time.time()
                while time.time() - start < 30:
                    ai.state.update()
                    if ai.state.combat.enemies_nearby:
                        ai.combat.engage_combat()
                    else:
                        print("No enemies detected...", end='\r')
                    time.sleep(0.2)
                print("\nCombat complete!")

            elif cmd == 'explore':
                print("Exploring for 30 seconds...")
                countdown(2)
                start = time.time()
                going_right = True
                while time.time() - start < 30:
                    if going_right:
                        ai.movement.move_right(0.3)
                    else:
                        ai.movement.move_left(0.3)
                    # Jump occasionally
                    if int(time.time()) % 3 == 0:
                        ai.movement.jump(0.15)
                    # Change direction every 5 seconds
                    if int(time.time() - start) % 5 == 0:
                        going_right = not going_right
                    time.sleep(0.1)
                print("Exploration complete!")

            elif cmd == 'boss':
                print("Attempting to summon Eye of Cthulhu...")
                print("(Must be night and have Suspicious Looking Eye in slot 10)")
                countdown(2)
                ai.combat.summon_eye_of_cthulhu()

            elif cmd == 'left':
                countdown(2)
                print("Moving left...")
                ai.movement.move_left(1.0)

            elif cmd == 'right':
                countdown(2)
                print("Moving right...")
                ai.movement.move_right(1.0)

            elif cmd == 'jump':
                countdown(2)
                print("Jumping...")
                ai.movement.jump(0.2)

            elif cmd.startswith('slot '):
                try:
                    slot = int(cmd.split()[1])
                    if 1 <= slot <= 10:
                        countdown(2)
                        print(f"Selecting slot {slot}...")
                        ai.inventory.select_slot(slot)
                    else:
                        print("Slot must be 1-10")
                except:
                    print("Usage: slot 1-10")

            elif cmd == 'click':
                countdown(2)
                print("Clicking at screen center...")
                frame = ai.vision.capture_screen()
                center_x = frame.shape[1] // 2
                center_y = frame.shape[0] // 2
                ai.input.click(center_x, center_y)

            elif cmd == 'status':
                print(ai.get_status())

            elif cmd == 'help':
                print("Commands: build, mine, fight, explore, boss, left, right,")
                print("          jump, slot 1-10, click, status, test, quit")

            else:
                print(f"Unknown command: {cmd}")
                print("Type 'help' for available commands")

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()

    ai.stop()


def build_mode(ai: TerrariaAI, count: int = 3):
    """Run in house building mode."""
    print(f"Building {count} NPC houses...")
    print("Make sure hotbar is set up: blocks, walls, doors, torches, furniture")

    for i in range(count):
        print(f"\nBuilding house {i+1}/{count}...")
        ai.building.build_npc_house()
        print(f"House {i+1} complete!")
        time.sleep(2)  # Brief pause between houses

    print("\nAll houses built!")


def mine_mode(ai: TerrariaAI, duration: int = 300):
    """Run in mining mode."""
    print(f"Mining for {duration} seconds...")
    print("Make sure pickaxe is in slot 1!")

    ai.inventory.select_pickaxe()
    start_time = time.time()
    blocks = 0

    while time.time() - start_time < duration:
        ai.mining.mine_below(0.5)
        blocks += 1
        elapsed = int(time.time() - start_time)
        remaining = duration - elapsed
        print(f"Mining... Blocks: ~{blocks} | Time left: {remaining}s", end='\r')
        time.sleep(0.3)

    print(f"\nMining complete! Approximately {blocks} blocks mined.")


def combat_mode(ai: TerrariaAI, duration: int = 300):
    """Run in combat training mode."""
    print(f"Combat training for {duration} seconds...")
    print("Make sure weapon is in slot 2!")
    print("Works best at night when zombies spawn.")

    ai.inventory.select_weapon()
    start_time = time.time()
    kills = 0

    while time.time() - start_time < duration:
        ai.state.update()

        if ai.state.combat.enemies_nearby:
            ai.combat.engage_combat()
            kills += 1

        remaining = duration - int(time.time() - start_time)
        print(f"Fighting... Kills: ~{kills} | Health: {ai.state.player.health*100:.0f}% | Time: {remaining}s", end='\r')
        time.sleep(0.2)

    print(f"\nCombat training complete! Approximately {kills} attack sequences.")


def demo_mode(ai: TerrariaAI):
    """Run a demonstration of AI capabilities."""
    print("""
╔═══════════════════════════════════════════════════════════╗
║              Terraria AI Agent - Demo Mode                 ║
╠═══════════════════════════════════════════════════════════╣
║ This demo will showcase the AI's capabilities:             ║
║   1. Move around                                           ║
║   2. Jump                                                  ║
║   3. Select different hotbar slots                         ║
║   4. Mine some blocks                                      ║
║   5. Build basic structure                                 ║
╚═══════════════════════════════════════════════════════════╝
    """)

    input("Press Enter to start the demo (make sure Terraria is focused!)...")

    # Phase 1: Movement
    print("\n[Phase 1] Testing movement...")
    print("Moving right...")
    ai.movement.move_right(1.0)
    time.sleep(0.5)

    print("Moving left...")
    ai.movement.move_left(1.0)
    time.sleep(0.5)

    print("Jumping...")
    ai.movement.jump(0.2)
    time.sleep(1)

    # Phase 2: Inventory
    print("\n[Phase 2] Testing inventory...")
    for slot in [1, 2, 3, 4, 5]:
        print(f"Selecting slot {slot}...")
        ai.inventory.select_slot(slot)
        time.sleep(0.5)

    # Phase 3: Mining
    print("\n[Phase 3] Testing mining (5 seconds)...")
    ai.inventory.select_pickaxe()
    start = time.time()
    while time.time() - start < 5:
        ai.mining.mine_below(0.3)
        time.sleep(0.2)

    # Phase 4: Screen analysis
    print("\n[Phase 4] Analyzing screen...")
    frame = ai.vision.capture_screen()
    health = ai.vision.get_health_percentage(frame)
    enemies = ai.vision.find_enemies(frame)
    print(f"  Health: {health*100:.1f}%")
    print(f"  Enemies nearby: {len(enemies)}")

    print("\n" + "="*60)
    print("Demo complete!")
    print("The AI successfully demonstrated:")
    print("  ✓ Movement (left, right, jump)")
    print("  ✓ Inventory management (slot selection)")
    print("  ✓ Mining")
    print("  ✓ Screen analysis")


def main():
    """Main entry point."""
    args = parse_args()

    print("""
    ╔════════════════════════════════════════════════════════════════╗
    ║                                                                ║
    ║     ████████╗███████╗██████╗ ██████╗  █████╗ ██████╗ ██╗ █████╗  ║
    ║     ╚══██╔══╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔══██╗██║██╔══██╗ ║
    ║        ██║   █████╗  ██████╔╝██████╔╝███████║██████╔╝██║███████║ ║
    ║        ██║   ██╔══╝  ██╔══██╗██╔══██╗██╔══██║██╔══██╗██║██╔══██║ ║
    ║        ██║   ███████╗██║  ██║██║  ██║██║  ██║██║  ██║██║██║  ██║ ║
    ║        ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ║
    ║                         █████╗ ██╗                               ║
    ║                        ██╔══██╗██║                               ║
    ║                        ███████║██║                               ║
    ║                        ██╔══██║██║                               ║
    ║                        ██║  ██║██║                               ║
    ║                        ╚═╝  ╚═╝╚═╝                               ║
    ║                                                                  ║
    ║                  Autonomous Terraria Player                      ║
    ║                                                                  ║
    ╚════════════════════════════════════════════════════════════════╝
    """)

    print("Initializing AI Agent...")
    print("Make sure Terraria is running in windowed mode at 1920x1080")
    print()

    # Create AI instance
    ai = TerrariaAI(config_path=args.config)

    # Set up signal handlers
    setup_signal_handlers(ai)

    # Configure hotbar if specified
    if args.hotbar:
        slots = [int(x) for x in args.hotbar.split(',')]
        if len(slots) >= 5:
            ai.configure_hotbar(
                pickaxe=slots[0],
                sword=slots[1],
                ranged=slots[2],
                building=slots[3],
                torch=slots[4]
            )
            print(f"Hotbar configured: {slots}")

    # Set initial goal if specified
    if args.goal:
        ai.set_goal(goal_from_string(args.goal))

    # Run in selected mode
    try:
        if args.mode == 'test':
            test_mode(ai)
        elif args.mode == 'interactive':
            interactive_mode(ai)
        elif args.mode == 'build':
            build_mode(ai)
        elif args.mode == 'mine':
            mine_mode(ai, args.duration or 300)
        elif args.mode == 'combat':
            combat_mode(ai, args.duration or 300)
        elif args.mode == 'demo':
            demo_mode(ai)
        else:  # auto mode
            print("Starting in automatic mode...")
            print("Press Ctrl+C to stop")
            print()
            ai.start()

    except KeyboardInterrupt:
        print("\nInterrupted by user")
    except Exception as e:
        print(f"Error: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
    finally:
        ai.cleanup()
        print("Goodbye!")


if __name__ == '__main__':
    main()
