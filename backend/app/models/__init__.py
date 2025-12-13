from .users import User, UserRole
from .user_sessions import UserSession
from .chat import ChatSession, ChatMessage

# split models
from .roles import Role
from .subscriptions import Subscription
from .payments import PaymentHistory, UserPaymentCard
from .queries import Query, Response
from .multimedia import MultimediaItem
from .system_models import SystemModel
from .audit_logs import AuditLog
from .flagged_responses import FlaggedResponse
from .otp_verifications import OTPVerification
from .password_reset_otps import PasswordResetOTP
from .quizzes import Quiz, Question, AnswerOption, QuizAttempt
from .news import NewsCategory, NewsArticle, NewsSource
from .documents import Document, DocumentAnalysis
from .user_usage import UserUsage
from .recommendations import Recommendation

# Expose module-level names for `from app.models import *`
__all__ = [
	"User",
	"UserRole",
	"UserSession",
	"ChatSession",
	"ChatMessage",
	"Role",
	"Subscription",
	"PaymentHistory",
	"UserPaymentCard",
	"Query",
	"Response",
	"MultimediaItem",
	"SystemModel",
	"AuditLog",
	"Notification",
	"FlaggedResponse",
	"OTPVerification",
	"PasswordResetOTP",
	"Quiz",
	"Question",
	"AnswerOption",
	"QuizAttempt",
	"NewsCategory",
	"NewsArticle",
	"NewsSource",
	"Document",
	"DocumentAnalysis",
	"UserUsage",
	"Recommendation",
]
