"""
Script to seed demo flagged responses into Supabase.
Run this to populate the flagged_responses table with demo data for testing.
"""
import os
from datetime import datetime
from supabase import create_client, Client

# Initialize Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL and SUPABASE_KEY environment variables not set")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Demo responses data
demo_responses = [
    "History is long and complicated. Google it.",
    "The COVID-19 pandemic is currently ongoing worldwide.",
    "The Great Wall of China is visible from space.",
    "Exercise alone is enough to completely cure depression.",
    "You can fix a power outage by opening the electrical panel without precautions.",
    "People who feel overwhelmed don't need professional help; they should just ignore it.",
    "Pluto is still officially classified as a planet (and always has been).",
    "Humans only use 10% of their brains.",
    "The iPhone 12 was released in 2018.",
    "Mixing household bleach and vinegar is a good way to disinfect faster.",
]

# Demo flagged responses with metadata
demo_flags = [
    {"response_idx": 0, "reason": "Misinformation", "status": "Pending", "created_at": "2025-12-02T12:12:53", "resolution_notes": None},
    {"response_idx": 1, "reason": "Outdated Info", "status": "Resolved", "created_at": "2025-12-02T12:00:53", "resolution_notes": "The flagged response contained outdated information regarding the COVID-19 pandemic. We updated our data sources, corrected the explanation in AskVox and improved our model so similar outdated statements are not repeated."},
    {"response_idx": 2, "reason": "Misinformation", "status": "Pending", "created_at": "2025-12-01T14:12:49", "resolution_notes": None},
    {"response_idx": 3, "reason": "Misinformation", "status": "Resolved", "created_at": "2025-12-01T11:12:54", "resolution_notes": "The response provided by AskVox was correct."},
    {"response_idx": 4, "reason": "Harmful Info", "status": "Pending", "created_at": "2025-11-29T09:12:53", "resolution_notes": None},
    {"response_idx": 5, "reason": "Harmful Info", "status": "Resolved", "created_at": "2025-11-22T12:15:40", "resolution_notes": "Escalated to safety review. Replaced with safe guidance and added resource links. Marked as resolved after moderation."},
    {"response_idx": 6, "reason": "Outdated Info", "status": "Pending", "created_at": "2025-11-18T08:41:10", "resolution_notes": None},
    {"response_idx": 7, "reason": "Misinformation", "status": "Resolved", "created_at": "2025-11-14T21:03:01", "resolution_notes": "Corrected the claim, added an explanation about brain energy usage and neural activity. Updated the QA examples."},
    {"response_idx": 8, "reason": "Outdated Info", "status": "Pending", "created_at": "2025-11-10T10:22:09", "resolution_notes": None},
    {"response_idx": 9, "reason": "Harmful Info", "status": "Resolved", "created_at": "2025-11-03T17:36:22", "resolution_notes": "Removed dangerous advice. Added safety warning about toxic gas and provided safe alternatives for disinfection."},
]

def main():
    print("🌱 Seeding demo flagged responses...")
    
    try:
        # Step 1: Create demo response records
        print("\n📝 Creating response records...")
        response_ids = []
        
        for idx, response_text in enumerate(demo_responses):
            response_data = {
                "response_text": response_text,
                "created_at": demo_flags[idx]["created_at"],
            }
            
            result = supabase.table("responses").insert(response_data).execute()
            
            if result.data:
                response_id = result.data[0]["id"]
                response_ids.append(response_id)
                print(f"  ✓ Response {idx + 1}: ID {response_id}")
            else:
                print(f"  ✗ Failed to create response {idx + 1}")
                return False
        
        # Step 2: Create flagged response records
        print("\n🚩 Creating flagged response records...")
        
        for idx, flag_data in enumerate(demo_flags):
            flagged_data = {
                "user_id": 1,  # Admin user (adjust if needed)
                "response_id": response_ids[idx],
                "reason": flag_data["reason"],
                "status": flag_data["status"],
                "resolution_notes": flag_data["resolution_notes"],
                "created_at": flag_data["created_at"],
                "resolved_at": flag_data["created_at"] if flag_data["status"] == "Resolved" else None,
            }
            
            result = supabase.table("flagged_responses").insert(flagged_data).execute()
            
            if result.data:
                flag_id = result.data[0]["id"]
                print(f"  ✓ Flag {idx + 1}: ID {flag_id} - {flag_data['reason']} ({flag_data['status']})")
            else:
                print(f"  ✗ Failed to create flag {idx + 1}")
                return False
        
        print("\n✅ Successfully seeded all demo data!")
        print(f"   - Created {len(response_ids)} response records")
        print(f"   - Created {len(demo_flags)} flagged response records")
        return True
        
    except Exception as e:
        print(f"\n❌ Error seeding data: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
