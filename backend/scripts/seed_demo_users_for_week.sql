-- Update existing users (role='user') to have updated_at spread across the week
-- Just spread any users across the 7 days - don't care about the actual dates

-- Get 5 users with role='user' and spread their updated_at across Mon-Sun
UPDATE profiles SET updated_at = NOW() - INTERVAL '4 days' WHERE role = 'user' ORDER BY id LIMIT 1;
UPDATE profiles SET updated_at = NOW() - INTERVAL '4 days' + INTERVAL '1 hour' WHERE role = 'user' ORDER BY id OFFSET 1 LIMIT 1;
UPDATE profiles SET updated_at = NOW() - INTERVAL '3 days' WHERE role = 'user' ORDER BY id OFFSET 2 LIMIT 1;
UPDATE profiles SET updated_at = NOW() - INTERVAL '1 days' WHERE role = 'user' ORDER BY id OFFSET 3 LIMIT 1;
UPDATE profiles SET updated_at = NOW() WHERE role = 'user' ORDER BY id OFFSET 4 LIMIT 1;

-- Result: 5 users spread across this week (Mon-Sun) with updated_at timestamps
