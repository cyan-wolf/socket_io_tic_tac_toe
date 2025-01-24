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

function fetchWaitingPlayer(waitingPlayers) {
    const playerIDs = Object.keys(waitingPlayers);
    const randomID = playerIDs[(Math.random() * playerIDs.length) << 0];

    const randomPlayer = waitingPlayers[randomID];

    delete waitingPlayers[randomID];
    return randomPlayer;
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
    players: {},
    waitingPlayers: {},
};

io.on("connection", (socket) => {
    socket.on("disconnect", (_reason) => {
        const playerID = socket.id;

        if (!globals.players[playerID]) {
            return;
        }
        delete globals.players[playerID];

        if (!globals.waitingPlayers[playerID]) {
            return;
        }
        delete globals.waitingPlayers[playerID];
    });

    socket.on("findPlayer", ({ name }) => {
        if (!name) {
            io.to(socket.id).emit("error", { message: "invalid name" });
            return;
        }
        globals.players[socket.id] = { name };
        globals.waitingPlayers[socket.id] = { socket, name };

        if (Object.keys(globals.waitingPlayers).length >= 2) {
            const conn1 = fetchWaitingPlayer(globals.waitingPlayers);
            const conn2 = fetchWaitingPlayer(globals.waitingPlayers);

            const p1 = {
                id: conn1.socket.id,
                name: conn1.name,
                tag: "X"
            };

            const p2 = {
                id: conn2.socket.id,
                name: conn2.name,
                tag: "O"
            };

            // Generate a random game ID.
            const gameID = generateGameID();

            const game = { 
                p1, p2, 
                client: {
                    id: gameID,
                    turn: "X", 
                    board: [
                        ["", "", ""], 
                        ["", "", ""], 
                        ["", "", ""]
                    ],
                    finished: false
                }
            };
            globals.games[gameID] = game;

            // Join the connections in the same room.
            conn1.socket.join(gameID);
            conn2.socket.join(gameID);

            // Tell each player some information about the game.
            conn1.socket.emit("foundGame", {
                game: game.client,
                ownTag: game.p1.tag,
                oppName: game.p2.name,
                oppTag: game.p2.tag,
            });
            conn2.socket.emit("foundGame", { 
                game: game.client,
                ownTag: game.p2.tag,
                oppName: game.p1.name, 
                oppTag: game.p1.tag,
            });
        }
    });
    
    socket.on("performMove", ({ id, move }) => {
        if (!(id in globals.games)) {
            return;
        }

        const game = globals.games[id];
        const game_client = game.client;
        const playerID = socket.id;

        if (game_client.finished) {
            return;
        }

        let tag;

        if (playerID === game.p1.id) {
            tag = game.p1.tag;
        } else if (playerID === game.p2.id) {
            tag = game.p2.tag;
        } else {
            return; // unknown player
        }

        if (tag === game_client.turn) {
            if (move < 0 || move > 9) {
                return;
            }
            // Calculate the row and column from the given move index.
            const row = Math.floor((move - 1) / 3);
            const col = (move - 1) % 3;

            if (game_client.board[row][col] != "") {
                return;
            }
            // Update the board.
            game_client.board[row][col] = tag;

            // Check if there was a winner.
            const winner = tryDetermineWinner(game_client.board);
            if (winner) {
                game_client.finished = true;
                io.to(id).emit("gameFinished", {winner});
            }

            // Toggle the turn.
            game_client.turn = (game_client.turn === "X") ? "O" : "X";

            // Return the updated game state to the connections in the room.
            io.to(id).emit("moveResponse", game_client);
        }
    });
});

const port = 3000;
server.listen(port, () => {
    console.log(`server listening on http://localhost:${port}`);
});
