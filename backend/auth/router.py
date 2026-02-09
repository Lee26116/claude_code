import hashlib
import hmac
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from config import settings
from auth.jwt import create_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _hash_password(password: str) -> str:
    return hashlib.sha256((password + settings.JWT_SECRET).encode()).hexdigest()


# Hash the admin password at startup
_admin_password_hash = _hash_password(settings.ADMIN_PASSWORD)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    expires_at: str


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    if req.username != settings.ADMIN_USERNAME or not hmac.compare_digest(
        _hash_password(req.password), _admin_password_hash
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return create_token(req.username)
