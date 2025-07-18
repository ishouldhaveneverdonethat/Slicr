from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow CORS from your frontend URL
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For MVP, allow all origins. Lock down later.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/slice")
async def slice_stl(file: UploadFile = File(...)):
    # For MVP just read file and return its filename and size
    contents = await file.read()
    size = len(contents)
    return {"filename": file.filename, "size_bytes": size, "message": "Stub slice done."}
