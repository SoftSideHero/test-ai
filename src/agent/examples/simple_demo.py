#!/usr/bin/env python3
"""
Simple demo showing how to use the Terraria AI Agent programmatically.
"""

import sys
import time
sys.path.insert(0, '..')

from terraria_ai import TerrariaAI
from terraria_ai.ai_agent import AIGoal


def main():
    """
    Simple demonstration of the Terraria AI Agent.
    """
    print("=== Terraria AI Agent - Simple Demo ===")
    print()
    print("This demo will:")
    print("1. Initialize the AI")
    print("2. Configure hotbar slots")
    print("3. Build one NPC house")
    print("4. Mine for 30 seconds")
    print("5. Show statistics")
    print()

    input("Make sure Terraria is running and press Enter to start...")

    # Create the AI agent
    with TerrariaAI() as ai:
        # Configure hotbar (customize these for your setup)
        ai.configure_hotbar(
            pickaxe=1,    # Slot 1 = Pickaxe
            sword=2,      # Slot 2 = Sword
            ranged=3,     # Slot 3 = Bow/Gun
            building=4,   # Slot 4 = Wood/Stone blocks
            torch=5       # Slot 5 = Torches
        )

        print("\n[1/3] Building an NPC house...")
        ai.build_house()

        # Wait for building to complete
        timeout = 60
        start = time.time()
        while ai.current_goal == AIGoal.BUILD_HOUSE:
            if time.time() - start > timeout:
                print("Building timeout - moving on")
                break
            time.sleep(0.5)

        print(f"Houses built: {ai.get_stats()['houses_built']}")

        print("\n[2/3] Mining for 30 seconds...")
        ai.set_goal(AIGoal.MINE)

        for i in range(30):
            time.sleep(1)
            stats = ai.get_stats()
            print(f"  Mining... Blocks: {stats['blocks_mined']}", end='\r')

        print()

        print("\n[3/3] Final statistics:")
        print(ai.get_status())


if __name__ == '__main__':
    main()
