import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "node:path";

const app = express();
app.use(express.static(path.resolve("")));

const server = http.createServer(app);
const io = new Server(server);

app.get("/", (req, res) => {
    res.sendFile("index.html");
});

function generateGameID() {
    return Math.random().toString().substring(2);
}

function detWinnerOfLine(slots) {
    let maybeWinner = slots[0];
    return slots.every((slot) => slot === maybeWinner);
}

// Determines the winner, if any.
function tryDetermineWinner(board) {
    const LINE_LEN = board.length;

    // Used for checking diagonals.
    let diagonal1 = [];
    let diagonal2 = [];

    for (let i = 0; i < LINE_LEN; i++) {
        // Checks rows.
        let row = board[i];

        if (detWinnerOfLine(row)) {
            return row[0];
        }

        // Checks columns.
        let column = [];

        for (let j = 0; j < LINE_LEN; j++) {
            column.push(board[j][i]);
        }
        if (detWinnerOfLine(column)) {
            return column[0];
        }

        // Fill in diagonals.
        diagonal1.push(board[i][i]);
        diagonal2.push(board[i][LINE_LEN - 1 - i]);
    }

    // Checks diagonals.
    if (detWinnerOfLine(diagonal1)) {
        return diagonal1[0];
    }
    else if (detWinnerOfLine(diagonal2)) {
        return diagonal2[0];
    }

    // No winner.
    return null;
}

const globals = {
    games: {},
    activePlayers: {},
    waitingPlayers: [],
};

io.on("connection", (socket) => {
    socket.on("auth", () => {
        const playerID = socket.id;
        socket.join(playerID);

        globals.activePlayers[playerID] = {};

        io.to(playerID).emit("authResponse", { playerID });
    });

    socket.on("disconnect", (_reason) => {
        const playerID = socket.id;

        if (!globals.activePlayers[playerID]) {
            return;
        }
        socket.leave(playerID);
        delete globals.activePlayers[playerID];
    });

    socket.on("findPlayer", (player) => {
        if (!player.name) {
            return;
        }

        globals.waitingPlayers.push({socket, name: player.name});

        if (globals.waitingPlayers.length >= 2) {
            const conn1 = globals.waitingPlayers.pop();
            const conn2 = globals.waitingPlayers.pop();

            const p1 = {
                name: conn1.name,
                tag: "X"
            };

            const p2 = {
                name: conn2.name,
                tag: "O"
            };

            // Generate a random game ID.
            const id = generateGameID();

            const game = { 
                id, p1, p2, 
                turn: "X", 
                board: [
                    ["", "", ""], 
                    ["", "", ""], 
                    ["", "", ""]
                ],
                finished: false
            };
            globals.games[id] = game;

            // Join the connections in the same room.
            conn1.socket.join(id);
            conn2.socket.join(id);

            io.to(id).emit("foundGame", game);
        }
    });
    
    socket.on("performMove", ({ id, move, name }) => {
        const game = globals.games[id];
        
        if (game.finished) {
            return;
        }

        let tag;

        if (name === game.p1.name) {
            tag = game.p1.tag;
        } else if (name === game.p2.name) {
            tag = game.p2.tag;
        }

        if (tag === game.turn) {
            if (move < 0 || move > 9) {
                return;
            }
            // Calculate the row and column from the given move index.
            const row = Math.floor((move - 1) / 3);
            const col = (move - 1) % 3;

            if (game.board[row][col] != "") {
                return;
            }
            // Update the board.
            game.board[row][col] = tag;

            // Check if there was a winner.
            const winner = tryDetermineWinner(game.board);
            if (winner) {
                game.finished = true;
                io.to(id).emit("gameFinished", {winner});
            }

            // Toggle the turn.
            game.turn = (game.turn === "X") ? "O" : "X";

            // Return the updated game state to the connections in the room.
            io.to(id).emit("moveResponse", game);
        }
    });
});

const port = 3000;
server.listen(port, () => {
    console.log(`server listening on http://localhost:${port}`);
});
