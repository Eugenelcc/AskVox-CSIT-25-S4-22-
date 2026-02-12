-- Seed demo flagged responses into Supabase
-- Run this SQL in Supabase SQL Editor (Query tab)

-- Insert the flagged responses (responses table already populated)
-- Assigned to Monkey user (victim3124@outlook.com)
INSERT INTO flagged_responses (user_id, response_id, reason, status, resolution_notes, created_at, resolved_at) VALUES
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 1, 'Misinformation', 'Pending', NULL, '2025-12-02T12:12:53', NULL),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 2, 'Outdated Info', 'Resolved', 'The flagged response contained outdated information regarding the COVID-19 pandemic. We updated our data sources, corrected the explanation in AskVox and improved our model so similar outdated statements are not repeated.', '2025-12-02T12:00:53', '2025-12-02T12:00:53'),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 3, 'Misinformation', 'Pending', NULL, '2025-12-01T14:12:49', NULL),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 4, 'Misinformation', 'Resolved', 'The response provided by AskVox was correct.', '2025-12-01T11:12:54', '2025-12-01T11:12:54'),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 5, 'Harmful Info', 'Pending', NULL, '2025-11-29T09:12:53', NULL),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 6, 'Harmful Info', 'Resolved', 'Escalated to safety review. Replaced with safe guidance and added resource links. Marked as resolved after moderation.', '2025-11-22T12:15:40', '2025-11-22T12:15:40'),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 7, 'Outdated Info', 'Pending', NULL, '2025-11-18T08:41:10', NULL),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 8, 'Misinformation', 'Resolved', 'Corrected the claim, added an explanation about brain energy usage and neural activity. Updated the QA examples.', '2025-11-14T21:03:01', '2025-11-14T21:03:01'),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 9, 'Outdated Info', 'Pending', NULL, '2025-11-10T10:22:09', NULL),
('a5a9b0ca-843f-4e96-92bd-38c4752e60c0', 10, 'Harmful Info', 'Resolved', 'Removed dangerous advice. Added safety warning about toxic gas and provided safe alternatives for disinfection.', '2025-11-03T17:36:22', '2025-11-03T17:36:22');
